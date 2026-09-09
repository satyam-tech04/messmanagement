/// What the meal-code screen is showing, and the rule for what to do next.
///
/// Ported from `qr-display.tsx`. The states are deliberately not collapsed into
/// "loading / data / error": being **served** is not an error, and a denial is a
/// decision rather than a fault. Both get their own screen, because a student
/// shown a red panel after being fed will hold their phone up again at a counter
/// that now refuses them.
library;

import '../../data/qr_token.dart';

sealed class QrState {
  const QrState();
}

/// Nothing fetched, and nothing will be until the student asks.
///
/// Opening the app to check the menu costs zero requests, and the rotation only
/// ever runs for someone actually about to be served.
class QrHidden extends QrState {
  const QrHidden();
}

class QrLoading extends QrState {
  const QrLoading();
}

class QrReady extends QrState {
  const QrReady(this.token);
  final QrToken token;
}

/// Shown for five minutes, then put away. The student can bring it straight
/// back, and until they do the screen is inert.
class QrExpired extends QrState {
  const QrExpired();
}

/// The student has eaten. A receipt, not a failure.
class QrServed extends QrState {
  const QrServed({required this.mealSlot, this.servedAt});
  final String mealSlot;
  final DateTime? servedAt;
}

/// A decision the student needs explaining — blocked, no plan, on a mess cut,
/// paused, outside meal hours.
class QrDenied extends QrState {
  const QrDenied({
    required this.code,
    required this.message,
    this.startDate,
    this.resumeDate,
  });

  final String code;
  final String message;

  /// Both dates, for `SUBSCRIPTION_PAUSED` — a student needs to know when their
  /// plan resumes, not merely that it is paused.
  final String? startDate;
  final String? resumeDate;
}

/// The request never arrived. Distinct from a denial: worth retrying soon,
/// because the student is standing in the queue right now.
class QrOffline extends QrState {
  const QrOffline();
}

/// How long a revealed code stays on screen before it is put away.
///
/// Long enough to cross a mess hall and queue; short enough that a phone left
/// on a table stops minting codes. A student still waiting taps once more —
/// which is also when they are closest to the counter, so the code they end up
/// showing is the freshest one.
const Duration kVisibleWindow = Duration(minutes: 5);

/// Seconds to wait before the next poll, by outcome.
///
/// Each number is a different judgement, which is why this is not one constant:
///
///  - **served** — slow. The meal is done; the only reason to keep polling is
///    so the next meal's code appears without a manual reload.
///  - **denied** — slow. A decision, not a blip. A student who pays at the
///    office should see their code return without reloading, but this must not
///    hammer an endpoint that has already said no.
///  - **offline** — fast. They are in the queue now.
int backoffSecondsFor(QrState state, {int? refreshSeconds}) => switch (state) {
  QrReady() => refreshSeconds ?? 15,
  QrServed() => 60,
  QrDenied() => 30,
  QrOffline() => 5,
  _ => 25,
};
