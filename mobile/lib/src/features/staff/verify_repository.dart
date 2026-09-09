/// Sending a scan to the counter endpoint, and holding on to it when that
/// fails.
///
/// The distinction this file exists to preserve: a **denial** is an answer, a
/// **transport failure** is not. Denials come back HTTP 200 with a domain code
/// precisely so a client cannot confuse the two — queueing a legitimate refusal
/// would retry it forever, and showing a dropped connection as a refusal would
/// turn away a student who is entitled to eat.
library;

import '../../core/api_failure.dart';
import '../../data/api_client.dart';
import 'scan_outcome.dart';
import 'scan_queue.dart';

class VerifyResult {
  const VerifyResult({
    required this.code,
    this.rollNumber,
    this.fullName,
    this.photoUrl,
    this.mealSlot,
    this.details,
    this.queued = false,
  });

  /// The domain code. Everything the UI decides keys off this, never a status.
  final String code;
  final String? rollNumber;
  final String? fullName;

  /// Relative path the counter loads while the result is on screen — the
  /// staff member's check that the face matches the record.
  final String? photoUrl;
  final String? mealSlot;
  final Map<String, dynamic>? details;

  /// Buffered locally rather than confirmed by the server.
  final bool queued;

  ScanOutcome get outcome => outcomeFor(code);
}

class VerifyRepository {
  VerifyRepository({required ApiClient api, required ScanQueue queue})
    : _api = api,
      _queue = queue;

  final ApiClient _api;
  final ScanQueue _queue;

  Future<VerifyResult> verifyQr({
    required String token,
    required String deviceId,
  }) => _send({'mode': 'QR', 'token': token, 'deviceId': deviceId});

  /// The audited manual fallback.
  ///
  /// Not a bypass: the server runs the identical eligibility policy, derives the
  /// service date from the mess's own clock so nothing can be backdated, and
  /// writes an `ATTENDANCE_MANUAL_OVERRIDE` audit row naming who did it and why.
  Future<VerifyResult> verifyManual({
    required String rollNumber,
    required String mealSlot,
    required String reason,
    required String deviceId,
  }) => _send({
    'mode': 'MANUAL',
    'rollNumber': rollNumber.trim(),
    'mealSlot': mealSlot,
    'reason': reason.trim(),
    'deviceId': deviceId,
  });

  Future<VerifyResult> _send(Map<String, dynamic> body) async {
    try {
      final json = await _api.post('/api/qr/verify', body: body);
      return VerifyResult(
        code: json['code'] as String? ?? (json['ok'] == true ? 'SERVED' : 'UNKNOWN'),
        rollNumber: json['rollNumber'] as String?,
        fullName: json['fullName'] as String?,
        photoUrl: json['photoUrl'] as String?,
        mealSlot: json['mealSlot'] as String?,
        details: (json['details'] as Map?)?.cast<String, dynamic>(),
      );
    } on ApiFailure catch (e) {
      // Only a transport failure is buffered. Everything else is the server
      // having answered — including a refusal, which must never be replayed.
      if (e.isOffline) {
        await _queue.enqueue(body);
        return const VerifyResult(code: kQueuedOffline, queued: true);
      }
      return VerifyResult(
        code: e.code,
        details: e.details,
        rollNumber: e.details?['rollNumber'] as String?,
      );
    }
  }

  /// Replay what the counter buffered while it was offline.
  ///
  /// Safe because the server is idempotent on
  /// `UNIQUE (tenant_id, student_id, service_date, meal_slot)`: a replayed scan
  /// yields `ALREADY_SERVED` and zero additional rows, which is this queue
  /// succeeding rather than failing.
  ///
  /// @returns how many scans were confirmed, for the counter's running total.
  Future<int> flush() async {
    var synced = 0;

    for (final entry in await _queue.pending()) {
      int? status;
      try {
        await _api.post('/api/qr/verify', body: entry.body);
        status = 200;
      } on ApiFailure catch (e) {
        status = e.isOffline ? null : (e.status ?? 500);
      }

      switch (verdictFor(status: status)) {
        case ReplayVerdict.synced:
          await _queue.remove(entry.id);
          synced++;
        case ReplayVerdict.rejected:
          await _queue.remove(entry.id);
        case ReplayVerdict.keep:
          // Stop at the first entry worth keeping. Continuing would hammer a
          // server that is already failing, mid-service.
          return synced;
      }
    }

    return synced;
  }
}
