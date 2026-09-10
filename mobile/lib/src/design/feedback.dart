/// Physical feedback, named by what it means rather than how strong it is.
///
/// Centralised for the same reason the colours are: `HapticFeedback.heavyImpact()`
/// sprinkled through screens is a decision made forty times, and the fortieth
/// will be the wrong weight. Here a caller says what happened and the mapping
/// lives in one place.
///
/// It matters most at the counter. During a rush the person scanning is looking
/// at the student, not the tablet — the tone and the buzz are often the only
/// signals they actually receive, which is why DESIGN.md asks for feedback that
/// does not rely on looking.
library;

import 'package:flutter/services.dart';

import 'status_badge.dart';

abstract final class Haptics {
  /// A deliberate action landed — a code revealed, a bill finalised.
  static void tap() => HapticFeedback.lightImpact();

  /// Something completed that the user was waiting on.
  static void success() => HapticFeedback.mediumImpact();

  /// A refusal. Heavier, because it must be distinguishable from success
  /// through a pocket or across a noisy counter.
  static void refusal() => HapticFeedback.heavyImpact();

  /// Matches the scanner's outcome vocabulary, so colour, sound and touch all
  /// say the same thing.
  static void forTone(StatusTone tone) => switch (tone) {
    StatusTone.active => success(),
    StatusTone.danger => refusal(),
    _ => tap(),
  };
}
