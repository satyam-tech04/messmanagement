/// The rotation loop behind the meal code.
///
/// One object owns the whole cycle. On the web this was split across several
/// effects and cascaded — each fetch set state, which re-ran the scheduling
/// effect, which cleared and re-armed the timer. Here a single timer re-arms
/// itself from the response's own `refreshSeconds`, so a mess changing its
/// rotation settings takes effect with no app release.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_failure.dart';
import '../../data/attendance_watcher.dart';
import '../../data/qr_token.dart';
import '../../state/auth_controller.dart';
import 'qr_state.dart';

class QrController extends Notifier<QrState> {
  Timer? _timer;
  DateTime? _revealedAt;
  bool _foreground = true;

  final _watcher = AttendanceWatcher();

  /// What the socket is currently watching, so a rotation does not tear down
  /// and rebuild it. The code changes every few seconds; the meal does not.
  String? _watching;

  @override
  QrState build() {
    ref.onDispose(() {
      _timer?.cancel();
      _watcher.stop();
    });
    return const QrHidden();
  }

  /// The student asked for a code. Nothing has run until this point.
  void reveal() {
    _revealedAt = DateTime.now();
    state = const QrLoading();
    _cycle();
  }

  void hide() {
    _timer?.cancel();
    _timer = null;
    _revealedAt = null;
    _stopWatching();
    state = const QrHidden();
  }

  /// Subscribe to this student's own attendance for the meal now on screen.
  ///
  /// Keyed on the meal rather than the token, so the socket survives a rotation
  /// instead of being rebuilt every few seconds.
  Future<void> _watch(QrToken token) async {
    final key = '${token.serviceDate}:${token.mealSlot}';
    if (_watching == key) return;

    final accessToken = ref.read(apiClientProvider).currentTokens?.accessToken;
    if (accessToken == null) return;

    _watching = key;
    try {
      await _watcher.watch(
        accessToken: accessToken,
        serviceDate: token.serviceDate,
        mealSlot: token.mealSlot,
        onServed: (scannedAt) {
          // Polling would reach the same conclusion within a refresh interval;
          // this is the same answer, immediately.
          if (state is! QrReady) return;
          state = QrServed(mealSlot: token.mealSlot, servedAt: scannedAt);
          _stopWatching();
        },
      );
    } catch (_) {
      // The socket is an accelerator, not a dependency. If it cannot be
      // established the rotation loop still notices ALREADY_SERVED on its next
      // poll, so a failure here must not surface to the student at all.
      _watching = null;
    }
  }

  void _stopWatching() {
    _watching = null;
    _watcher.stop();
  }

  /// A phone asleep in a pocket wakes with a dead code on screen. Refresh the
  /// moment it comes back rather than showing something already expired — this
  /// is also what restarts a loop that [onPaused] parked.
  void onResumed() {
    _foreground = true;
    if (_revealedAt == null) return;
    _timer?.cancel();
    _cycle();
  }

  /// Nobody is looking, so nothing needs minting.
  ///
  /// A student who reveals their code and pockets the phone while queuing was,
  /// without this, minting a token every fifteen seconds for the whole meal —
  /// each one several database round trips including a write. Across a few
  /// hundred students that is the single largest source of load in the system,
  /// all of it for codes nobody will ever see.
  ///
  /// Parking is safe because [onResumed] mints a fresh one immediately, which is
  /// also *more* correct: a code minted while hidden would usually have expired
  /// before anyone looked at it.
  void onPaused() {
    _foreground = false;
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _cycle() async {
    final revealedAt = _revealedAt;
    if (revealedAt == null || !_foreground) return;

    // Put the code away rather than rotating it forever.
    if (DateTime.now().difference(revealedAt) > kVisibleWindow) {
      state = const QrExpired();
      _timer = null;
      _stopWatching();
      return;
    }

    final next = await _fetch();

    // Anything that happened while the request was in flight wins: the student
    // may have hidden the code, or the app may have gone to the background.
    if (_revealedAt != revealedAt || !_foreground) return;

    _timer = Timer(Duration(seconds: next), _cycle);
  }

  /// Fetches one token and maps the outcome to a state.
  ///
  /// @returns seconds until the next attempt.
  Future<int> _fetch() async {
    try {
      final json = await ref.read(apiClientProvider).get('/api/qr/token');
      final token = QrToken.fromJson(json);
      state = QrReady(token);
      _watch(token);
      return backoffSecondsFor(state, refreshSeconds: token.refreshSeconds);
    } on ApiFailure catch (e) {
      // Being fed is not a failure. Render it as a receipt so the student puts
      // their phone away, rather than a red panel that reads as a fault — and
      // then holds the code up again at a counter that will refuse them.
      if (e.code == 'ALREADY_SERVED') {
        final at = e.details?['servedAt'];
        state = QrServed(
          mealSlot: e.details?['slot'] as String? ?? 'This meal',
          servedAt: at is String ? DateTime.tryParse(at)?.toLocal() : null,
        );
        return backoffSecondsFor(state);
      }

      if (e.isOffline) {
        state = const QrOffline();
        return backoffSecondsFor(state);
      }

      _stopWatching();
      state = QrDenied(
        code: e.code,
        message: e.message,
        startDate: e.details?['startDate'] as String?,
        resumeDate: e.details?['resumeDate'] as String?,
      );
      return backoffSecondsFor(state);
    } catch (_) {
      state = const QrOffline();
      return backoffSecondsFor(state);
    }
  }
}

final qrControllerProvider = NotifierProvider<QrController, QrState>(
  QrController.new,
);
