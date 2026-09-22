/// The decisions inside push that do not need a device (D-34).
///
/// Pulled out of `push.dart` so they can be tested: each one is a bug that
/// produces no error anywhere, only a notification that silently did not
/// appear, appeared twice, or opened nowhere.
library;

import 'package:flutter/foundation.dart';

/// The Android notification channel every MealAdda notification uses.
///
/// Must match the id the server puts in each FCM message and the default
/// declared in the Android manifest, or background notifications land in the
/// generic "Miscellaneous" channel a student cannot silence separately.
/// `tests/unit/push-channel.test.ts` checks all three agree.
const androidChannelId = 'mealadda_default';

/// Whether the app must draw a notification itself while it is open.
///
/// **Android yes:** FCM displays notifications only while the app is in the
/// background. In the foreground it hands the message over and shows nothing,
/// so a student with the app open would never see an announcement.
///
/// **iOS no:** the foreground presentation options already make iOS show it.
/// Drawing one locally as well would show every notification twice.
bool showsInForeground(TargetPlatform platform) =>
    platform == TargetPlatform.android;

/// The in-app route a tapped notification points at, or null.
///
/// The payload arrives off the network, so only a plain in-app path is
/// accepted — `/menu`, never `https://…` or a scheme. The shell then maps it
/// through a fixed table, so this is a second fence, not the only one.
String? routeFromData(Map<String, dynamic> data) {
  final route = data['route'];
  if (route is! String || route.isEmpty) return null;
  if (!RegExp(r'^/[a-z-]+$').hasMatch(route)) return null;
  return route;
}

/// Calls [probe] until it returns a value, up to [attempts] times.
///
/// Exists for one iOS problem: asking Firebase for a token before Apple has
/// issued its APNs token throws, which is the normal state on a fresh install.
/// Waiting briefly for the APNs token first is what turns "push works from the
/// second launch" into "push works".
///
/// A probe that throws counts as "not yet" — the device that has not finished
/// registering is exactly the case being waited out. Returns null rather than
/// waiting forever: an app must never hang on push.
Future<T?> pollUntil<T>(
  Future<T?> Function() probe, {
  int attempts = 10,
  Duration interval = const Duration(milliseconds: 500),
}) async {
  for (var i = 0; i < attempts; i++) {
    try {
      final value = await probe();
      if (value != null) return value;
    } catch (_) {
      // Not ready yet; see above.
    }
    if (i < attempts - 1) await Future<void>.delayed(interval);
  }
  return null;
}
