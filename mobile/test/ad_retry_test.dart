import 'package:flutter_test/flutter_test.dart';
import 'package:mealadda/src/features/ads/ad_retry.dart';

/// When a banner that failed to load may be asked for again (D-35).
///
/// The slot used to ask again the instant a request failed. A failure is
/// usually something that is still true a millisecond later — no signal in the
/// mess hall, an ad-blocking DNS, no inventory — so that was a loop building a
/// fresh native ad view on every turn until the phone gave up on the app.
/// These cases pin the two properties that make it safe: there is always a
/// wait, and it always ends.
void main() {
  test('never retries immediately', () {
    for (var failures = 1; failures <= maxAdRetries; failures++) {
      expect(
        adRetryDelay(failures)!,
        greaterThanOrEqualTo(const Duration(seconds: 30)),
      );
    }
  });

  test('waits longer after each failure', () {
    for (var failures = 2; failures <= maxAdRetries; failures++) {
      expect(adRetryDelay(failures)!, greaterThan(adRetryDelay(failures - 1)!));
    }
  });

  test('gives up for the rest of the session', () {
    // An ad is not something the student asked for. After a few tries the
    // right amount of effort is none; the next launch starts afresh.
    expect(adRetryDelay(maxAdRetries + 1), isNull);
    expect(adRetryDelay(maxAdRetries + 50), isNull);
  });

  test('a session spends a bounded number of requests on a dead slot', () {
    var requests = 1; // the first load
    for (var failures = 1; adRetryDelay(failures) != null; failures++) {
      requests++;
    }
    expect(requests, maxAdRetries + 1);
  });

  test('treats a nonsense count as no retry rather than a zero wait', () {
    expect(adRetryDelay(0), isNull);
    expect(adRetryDelay(-1), isNull);
  });
}
