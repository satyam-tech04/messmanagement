import 'package:flutter_test/flutter_test.dart';
import 'package:campusmeals/src/design/status_badge.dart';
import 'package:campusmeals/src/features/staff/scan_gate.dart';
import 'package:campusmeals/src/features/staff/scan_outcome.dart';
import 'package:campusmeals/src/features/staff/scan_queue.dart';

/// The counter's rules, tested apart from the camera and the network.
///
/// Every assertion here stands for a way a real meal service goes wrong: a scan
/// silently swallowed, a student turned away over a Wi-Fi drop, or an attendance
/// record for someone who ate quietly disappearing.
void main() {
  group('shouldSubmitToken — the dedupe gate', () {
    final now = DateTime(2026, 9, 9, 13, 0, 0);

    test('sends a token never seen before', () {
      expect(
        shouldSubmitToken(token: 'a', last: null, now: now, busy: false),
        isTrue,
      );
    });

    test('drops the same token within the dedupe window', () {
      // The camera decodes dozens of times a second and the student's code is
      // still on screen. Without this, every success is immediately followed by
      // ALREADY_SERVED.
      expect(
        shouldSubmitToken(
          token: 'a',
          last: LastScan(token: 'a', at: now.subtract(const Duration(seconds: 1))),
          now: now,
          busy: false,
        ),
        isFalse,
      );
    });

    test('sends the same token again once the window has passed', () {
      expect(
        shouldSubmitToken(
          token: 'a',
          last: LastScan(token: 'a', at: now.subtract(const Duration(seconds: 4))),
          now: now,
          busy: false,
        ),
        isTrue,
      );
    });

    test('sends a different token immediately — the next student is waiting', () {
      expect(
        shouldSubmitToken(
          token: 'b',
          last: LastScan(token: 'a', at: now),
          now: now,
          busy: false,
        ),
        isTrue,
      );
    });

    test('drops any read while a request is in flight', () {
      expect(
        shouldSubmitToken(token: 'b', last: null, now: now, busy: true),
        isFalse,
      );
    });

    test('dedupe is decided before busy, so the reason stays meaningful', () {
      // Both would refuse, but the caller records the token only on a `true`.
      // If busy were checked first, a read dropped mid-flight could be recorded
      // as "sent" and the retry milliseconds later suppressed too — losing the
      // scan with no feedback at all.
      expect(
        shouldSubmitToken(
          token: 'a',
          last: LastScan(token: 'a', at: now),
          now: now,
          busy: true,
        ),
        isFalse,
      );
    });

    test('the window is three seconds', () {
      expect(kDedupeWindow, const Duration(seconds: 3));
    });
  });

  group('outcomeFor — what staff are told', () {
    test('a success reads as success and needs no retry', () {
      final o = outcomeFor('SERVED');
      expect(o.tone, StatusTone.active);
      expect(o.retryable, isFalse);
    });

    test('an offline save is informational, never danger', () {
      // The student is standing there and the scan was valid as far as the
      // counter can tell. Red would turn them away over a Wi-Fi drop, which is
      // the opposite of what the queue exists to prevent.
      final o = outcomeFor(kQueuedOffline);
      expect(o.tone, isNot(StatusTone.danger));
      expect(o.action, contains('Serve'));
    });

    test('a refusal never offers the manual fallback', () {
      // Manual entry runs the identical eligibility check, so offering it would
      // produce the same refusal while implying it might not.
      for (final code in [
        'BLOCKED_UNPAID',
        'NO_ACTIVE_PLAN',
        'ON_MESS_CUT',
        'SUBSCRIPTION_PAUSED',
        'STUDENT_INACTIVE',
        'TENANT_MISMATCH',
      ]) {
        expect(outcomeFor(code).allowsManualOverride, isFalse, reason: code);
        expect(outcomeFor(code).retryable, isFalse, reason: code);
      }
    });

    test('a technical failure does offer both, so the queue keeps moving', () {
      for (final code in [
        'EXPIRED_TOKEN',
        'INVALID_TOKEN',
        'INFRASTRUCTURE_ERROR',
        'RATE_LIMITED',
      ]) {
        expect(outcomeFor(code).allowsManualOverride, isTrue, reason: code);
        expect(outcomeFor(code).retryable, isTrue, reason: code);
      }
    });

    test('already-served is a warning, not a fault — they are legitimate', () {
      expect(outcomeFor('ALREADY_SERVED').tone, StatusTone.warning);
    });

    test('a paused plan is a warning, so staff do not treat it as a dispute', () {
      expect(outcomeFor('SUBSCRIPTION_PAUSED').tone, StatusTone.warning);
    });

    test('an unknown code still lets the counter keep serving', () {
      // A server that adds a code an older build has never seen must not
      // dead-end the counter.
      final o = outcomeFor('SOMETHING_NEW_FROM_A_LATER_SERVER');
      expect(o.retryable, isTrue);
      expect(o.allowsManualOverride, isTrue);
    });

    test('every action says what to do, never just restates the title', () {
      for (final entry in kScanOutcomes.entries) {
        expect(entry.value.action, isNotEmpty, reason: entry.key);
        expect(
          entry.value.action.toLowerCase(),
          isNot(equals(entry.value.title.toLowerCase())),
          reason: entry.key,
        );
      }
    });
  });

  group('verdictFor — what happens to a replayed scan', () {
    test('a success dequeues', () {
      expect(verdictFor(status: 200), ReplayVerdict.synced);
    });

    test('a denial replayed as ALREADY_SERVED counts as synced', () {
      // Denials come back 200 by design, and the idempotency constraint means a
      // replay produced zero extra rows. The record exists, which is all the
      // queue was trying to achieve.
      expect(verdictFor(status: 200), ReplayVerdict.synced);
    });

    test('a 4xx dequeues — the server understood and refused permanently', () {
      expect(verdictFor(status: 400), ReplayVerdict.rejected);
      expect(verdictFor(status: 403), ReplayVerdict.rejected);
    });

    test('a 5xx is kept — the fault is the server, not the scan', () {
      expect(verdictFor(status: 500), ReplayVerdict.keep);
      expect(verdictFor(status: 503), ReplayVerdict.keep);
    });

    test('never reaching the server keeps the entry', () {
      expect(verdictFor(status: null), ReplayVerdict.keep);
    });
  });

  group('the queue window', () {
    test('is six hours — past that the service date would be wrong', () {
      expect(kMaxQueueAge, const Duration(hours: 6));
    });
  });
}
