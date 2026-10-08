/// When a banner that failed to load may be asked for again (D-35).
///
/// Pulled out of `ad_banner.dart` so it can be tested: the slot once retried
/// the instant a request failed, and since a failure is usually still true a
/// millisecond later — no signal, an ad-blocking DNS, no inventory — that was
/// a loop building a fresh native ad view on every turn.
library;

/// How many times one slot asks again in a session before leaving it empty.
const maxAdRetries = 3;

const _firstRetry = Duration(seconds: 30);

/// How long to wait before the next request, given how many have failed in a
/// row, or null to stop asking until the next launch.
///
/// Doubles each time: 30 seconds, one minute, two. Never zero — a count that
/// makes no sense means no retry, not an immediate one.
Duration? adRetryDelay(int failures) {
  if (failures < 1 || failures > maxAdRetries) return null;
  return _firstRetry * (1 << (failures - 1));
}
