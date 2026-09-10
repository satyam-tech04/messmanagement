import 'package:flutter_test/flutter_test.dart';
import 'package:campusmeals/src/data/qr_token.dart';
import 'package:campusmeals/src/features/student/qr_state.dart';

/// How often the meal code screen goes back to the server.
///
/// These numbers are load-bearing, and each is a different judgement rather than
/// one shared constant. Getting them wrong is not a cosmetic bug:
///
///   - Too fast on a denial and the app hammers an endpoint that has already
///     said no, for every blocked student in the hostel, three times a day.
///   - Too slow when offline and a student standing in the queue watches a dead
///     screen.
///   - Ignoring the server's own `refreshSeconds` means a mess that changes its
///     rotation cannot take effect without an app release — and worse, a client
///     polling faster than the token TTL is the one case that would show a
///     student a code that is already dead.
void main() {
  QrToken token({int refreshSeconds = 15}) => QrToken(
    token: 'signed.payload',
    mealSlot: 'LUNCH',
    serviceDate: '2026-09-09',
    expiresAt: DateTime.now().add(const Duration(seconds: 30)),
    refreshSeconds: refreshSeconds,
    isOpenNow: true,
    studentName: 'Asha Rao',
    rollNumber: 'cs21b001',
  );

  group('backoffSecondsFor', () {
    test('follows the server when a code is live, not a local constant', () {
      expect(
        backoffSecondsFor(QrReady(token(refreshSeconds: 20)), refreshSeconds: 20),
        20,
      );
      expect(
        backoffSecondsFor(QrReady(token(refreshSeconds: 8)), refreshSeconds: 8),
        8,
      );
    });

    test('polls slowly once served — the meal is over', () {
      // Still polls at all, so the next meal's code appears without the student
      // reloading anything.
      expect(backoffSecondsFor(const QrServed(mealSlot: 'LUNCH')), 60);
    });

    test('polls slowly on a denial, which is a decision and not a blip', () {
      // Slow enough not to hammer, frequent enough that a student who pays at
      // the office sees their code return on its own.
      expect(
        backoffSecondsFor(
          const QrDenied(code: 'BLOCKED_UNPAID', message: 'x'),
        ),
        30,
      );
    });

    test('retries quickly when offline — they are in the queue right now', () {
      expect(backoffSecondsFor(const QrOffline()), 5);
    });

    test('never returns zero, which would be a tight polling loop', () {
      for (final state in <QrState>[
        QrReady(token()),
        const QrServed(mealSlot: 'LUNCH'),
        const QrDenied(code: 'X', message: 'x'),
        const QrOffline(),
        const QrHidden(),
        const QrExpired(),
        const QrLoading(),
      ]) {
        expect(backoffSecondsFor(state), greaterThan(0));
      }
    });
  });

  group('the visible window', () {
    test('is five minutes — long enough to queue, short enough to stop', () {
      expect(kVisibleWindow, const Duration(minutes: 5));
    });
  });

  group('QrToken.fromJson', () {
    test('reads what the endpoint actually returns', () {
      final t = QrToken.fromJson({
        'token': 'abc.def',
        'mealSlot': 'DINNER',
        'serviceDate': '2026-09-09',
        'expiresAt': '2026-09-09T13:00:30.000Z',
        'refreshSeconds': 15,
        'isOpenNow': true,
        'studentName': 'Asha Rao',
        'rollNumber': 'cs21b001',
      });
      expect(t.token, 'abc.def');
      expect(t.mealSlot, 'DINNER');
      expect(t.serviceDate, '2026-09-09');
      expect(t.refreshSeconds, 15);
      expect(t.isOpenNow, isTrue);
    });

    test('never lets a missing refreshSeconds become zero', () {
      // A zero would be a tight loop against an endpoint that costs several
      // database round trips per call, including a write.
      final t = QrToken.fromJson({'token': 'abc.def'});
      expect(t.refreshSeconds, greaterThan(0));
    });

    test('keeps the service date as the server sent it', () {
      // The meal's date, derived in the mess's timezone — never re-derived from
      // the phone's clock. A dinner past midnight belongs to the day it started.
      final t = QrToken.fromJson({
        'token': 'a.b',
        'serviceDate': '2026-09-09',
      });
      expect(t.serviceDate, '2026-09-09');
    });
  });
}
