import 'package:flutter_test/flutter_test.dart';
import 'package:messmate/src/core/api_failure.dart';

/// How a failure is classified, because the classification decides behaviour.
///
/// Getting these wrong is not cosmetic. `isTransient` is what says "this may be
/// worth trying again"; if a refusal were ever classified transient, the app
/// would keep asking a question the server has already answered — for a blocked
/// student, three times a day, forever.
///
/// And the split between offline and server-fault decides what the user is
/// told. Sending someone to restart a router that was never the problem is a
/// worse outcome than saying nothing.
void main() {
  ApiFailure failure(String code, {int? status}) =>
      ApiFailure(code: code, message: 'x', status: status);

  group('what counts as offline', () {
    test('a dropped connection and a timeout both do', () {
      expect(failure('NETWORK_ERROR').isOffline, isTrue);
      expect(failure('TIMEOUT').isOffline, isTrue);
    });

    test('a refusal never does', () {
      // The scanner's queue keys off this: a denial that looked offline would
      // be buffered and replayed forever.
      for (final code in [
        'BLOCKED_UNPAID',
        'NO_ACTIVE_PLAN',
        'ALREADY_SERVED',
        'FORBIDDEN',
      ]) {
        expect(failure(code).isOffline, isFalse, reason: code);
      }
    });
  });

  group('what counts as the server\'s fault', () {
    test('an infrastructure error and any 5xx', () {
      expect(failure('INFRASTRUCTURE_ERROR').isServerFault, isTrue);
      expect(failure('UNKNOWN', status: 500).isServerFault, isTrue);
      expect(failure('UNKNOWN', status: 503).isServerFault, isTrue);
    });

    test('a 4xx does not — the server understood and refused', () {
      expect(failure('VALIDATION_FAILED', status: 400).isServerFault, isFalse);
      expect(failure('FORBIDDEN', status: 403).isServerFault, isFalse);
      expect(failure('CONFLICT', status: 409).isServerFault, isFalse);
    });

    test('being offline is not the server\'s fault', () {
      // Different advice: waiting helps for one, moving helps for the other.
      expect(failure('NETWORK_ERROR').isServerFault, isFalse);
    });
  });

  group('what is worth trying again', () {
    test('transport trouble, server trouble and rate limiting', () {
      expect(failure('NETWORK_ERROR').isTransient, isTrue);
      expect(failure('TIMEOUT').isTransient, isTrue);
      expect(failure('INFRASTRUCTURE_ERROR').isTransient, isTrue);
      expect(failure('RATE_LIMITED').isTransient, isTrue);
    });

    test('a decision never is', () {
      // Repeating the question does not change the answer, and asking again is
      // how a blocked student's phone hammers the counter endpoint all service.
      for (final code in [
        'BLOCKED_UNPAID',
        'NO_ACTIVE_PLAN',
        'ON_MESS_CUT',
        'SUBSCRIPTION_PAUSED',
        'ALREADY_SERVED',
        'STUDENT_INACTIVE',
        'FORBIDDEN',
        'PASSWORD_CHANGE_REQUIRED',
      ]) {
        expect(failure(code).isTransient, isFalse, reason: code);
      }
    });

    test('an expired session is not — it needs a sign-in, not a retry', () {
      expect(failure('UNAUTHENTICATED').isTransient, isFalse);
    });
  });

  group('the gates the app routes on', () {
    test('an expired session is recognised', () {
      expect(failure('UNAUTHENTICATED').isUnauthenticated, isTrue);
    });

    test('the forced password change is recognised', () {
      expect(failure('PASSWORD_CHANGE_REQUIRED').needsPasswordChange, isTrue);
    });

    test('and neither is mistaken for the other', () {
      expect(failure('UNAUTHENTICATED').needsPasswordChange, isFalse);
      expect(failure('PASSWORD_CHANGE_REQUIRED').isUnauthenticated, isFalse);
    });
  });
}
