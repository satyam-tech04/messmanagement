/// Which camera reads become requests.
///
/// The camera decodes the same QR code dozens of times a second, so something
/// has to sit between the decoder and `/api/qr/verify`. Pure and separate from
/// the widget because the rule has two opposite failure modes and **both are
/// silent in the UI**:
///
///  - *too permissive* — every success is instantly followed by ALREADY_SERVED,
///    because the student's code is still on screen;
///  - *too strict* — a read dropped while a request is in flight gets remembered
///    as "seen", so the retry milliseconds later is suppressed too and the scan
///    is lost with no feedback at all.
///
/// The caller must record the token **only when this returns true**. Recording
/// before the busy check is exactly the second bug.
library;

/// How long the same token is ignored after it has been sent.
const Duration kDedupeWindow = Duration(seconds: 3);

class LastScan {
  const LastScan({required this.token, required this.at});

  /// The last token actually **sent**, not merely seen.
  final String token;
  final DateTime at;
}

bool shouldSubmitToken({
  required String token,
  required LastScan? last,
  required DateTime now,
  /// True while a verify request is in flight.
  required bool busy,
}) {
  // Dedupe first, so a repeat read is rejected for the right reason and the
  // caller's "did we send this?" record stays meaningful either way.
  if (last != null &&
      last.token == token &&
      now.difference(last.at) < kDedupeWindow) {
    return false;
  }

  // One request at a time. The read is dropped, NOT recorded — the camera is
  // still pointed at the code and will offer it again in a few milliseconds.
  if (busy) return false;

  return true;
}
