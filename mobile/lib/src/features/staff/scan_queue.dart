/// Scans buffered while the counter is offline (§6.4).
///
/// Counter Wi-Fi drops. When it does, the scan is buffered and replayed rather
/// than lost — the student has already walked away with their food, so the
/// attendance row must eventually exist.
///
/// Replay is safe because the server is idempotent: the
/// `UNIQUE (tenant_id, student_id, service_date, meal_slot)` constraint means a
/// replayed scan produces `ALREADY_SERVED` and zero additional rows. That is a
/// **success** from this queue's point of view — the record exists, which is all
/// it was trying to achieve.
///
/// Only a transport failure is ever queued. An HTTP denial is a decision the
/// server has already made, and queueing it would retry a legitimate refusal
/// forever — which is exactly why `/api/qr/verify` answers denials with 200.
library;

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Beyond this the meal is over and replaying would file the wrong service
/// date, so a stale entry must not be synced.
///
/// It must not be **discarded** either. These are students who already walked
/// away with their food; a tablet left offline overnight would otherwise erase a
/// whole service with nobody ever knowing. Stale entries are held back from sync
/// and surfaced to staff instead — see [expired].
const Duration kMaxQueueAge = Duration(hours: 6);

const int _maxEntries = 500;
const String _storageKey = 'campusmeals.scanQueue.v1';

class QueuedScan {
  const QueuedScan({
    required this.id,
    required this.queuedAt,
    required this.body,
  });

  /// Client-generated, so a retry of the same buffered scan is recognisable.
  final String id;
  final DateTime queuedAt;

  /// The exact verify request body, replayed unchanged.
  final Map<String, dynamic> body;

  Map<String, dynamic> toJson() => {
    'id': id,
    'queuedAt': queuedAt.millisecondsSinceEpoch,
    'body': body,
  };

  static QueuedScan? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['id'];
    final at = raw['queuedAt'];
    final body = raw['body'];
    if (id is! String || at is! int || body is! Map) return null;
    return QueuedScan(
      id: id,
      queuedAt: DateTime.fromMillisecondsSinceEpoch(at),
      body: body.cast<String, dynamic>(),
    );
  }
}

class ScanQueue {
  ScanQueue({SharedPreferences? prefs}) : _injected = prefs;

  final SharedPreferences? _injected;
  SharedPreferences? _prefs;

  Future<SharedPreferences> get _store async =>
      _prefs ??= _injected ?? await SharedPreferences.getInstance();

  Future<List<QueuedScan>> _read() async {
    try {
      final raw = (await _store).getString(_storageKey);
      if (raw == null) return [];
      final decoded = jsonDecode(raw);
      if (decoded is! List) return [];
      return decoded
          .map(QueuedScan.fromJson)
          .whereType<QueuedScan>()
          .toList(growable: false);
    } catch (_) {
      // Corrupt storage is treated as empty rather than throwing. A scanner
      // that will not start because of a malformed cache is worse than one that
      // has forgotten a queue it could not have read anyway.
      return [];
    }
  }

  Future<void> _write(List<QueuedScan> entries) async {
    try {
      // Keep the newest. If the cap is ever hit something is badly wrong, and
      // the most recent scans are the ones still inside their service window.
      final kept = entries.length > _maxEntries
          ? entries.sublist(entries.length - _maxEntries)
          : entries;
      await (await _store).setString(
        _storageKey,
        jsonEncode(kept.map((e) => e.toJson()).toList()),
      );
    } catch (_) {
      // Swallowed: a quota error must not take down the counter mid-service.
    }
  }

  Future<void> enqueue(Map<String, dynamic> body) async {
    final entries = [...await _read()];
    entries.add(
      QueuedScan(
        id: '${DateTime.now().millisecondsSinceEpoch}-${entries.length}',
        queuedAt: DateTime.now(),
        body: body,
      ),
    );
    await _write(entries);
  }

  /// Entries still inside their service window, and therefore safe to replay.
  Future<List<QueuedScan>> pending({DateTime? now}) async {
    final at = now ?? DateTime.now();
    return (await _read())
        .where((e) => at.difference(e.queuedAt) < kMaxQueueAge)
        .toList(growable: false);
  }

  /// Entries too old to replay — held, never deleted, and surfaced to staff.
  ///
  /// Each one is a student who ate. Silently dropping them would erase a
  /// service; replaying them would file it against the wrong day.
  Future<List<QueuedScan>> expired({DateTime? now}) async {
    final at = now ?? DateTime.now();
    return (await _read())
        .where((e) => at.difference(e.queuedAt) >= kMaxQueueAge)
        .toList(growable: false);
  }

  Future<void> remove(String id) async {
    final entries = (await _read()).where((e) => e.id != id).toList();
    await _write(entries);
  }

  /// Staff have been told about the stale entries and dismissed them.
  Future<void> clearExpired({DateTime? now}) async {
    final at = now ?? DateTime.now();
    await _write(
      (await _read())
          .where((e) => at.difference(e.queuedAt) < kMaxQueueAge)
          .toList(),
    );
  }
}

/// What to do with a queued scan after the server answered.
enum ReplayVerdict {
  /// The record exists. Dequeue.
  ///
  /// Includes `ALREADY_SERVED`: a replayed scan hitting the idempotency
  /// constraint is the queue succeeding, not failing.
  synced,

  /// The server understood and refused permanently. Dequeue — retrying a 4xx
  /// forever helps nobody.
  rejected,

  /// Server fault or no connection. Keep it and try later.
  keep,
}

/// Decides a queued scan's fate from the transport outcome.
///
/// Pure so the rule can be tested without a network: the difference between
/// dropping a student's meal record and retrying forever is one branch here.
ReplayVerdict verdictFor({required int? status}) {
  if (status == null) return ReplayVerdict.keep; // never reached the server
  if (status >= 200 && status < 300) return ReplayVerdict.synced;
  if (status >= 400 && status < 500) return ReplayVerdict.rejected;
  return ReplayVerdict.keep; // 5xx — the server's problem, not the scan's
}
