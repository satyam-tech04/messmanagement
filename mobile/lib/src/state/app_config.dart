/// What the server tells the app to do, read once at launch (D-35).
///
/// One request answers two questions that used to be compiled in: whether this
/// build is still allowed to run, and whether to show ads — where, and with
/// which unit. Both can then be changed from the operator console without a
/// store release, which is the point.
///
/// **Fails open on the update gate and closed on ads.** An unreachable server
/// must not show every student an update screen mid-service; it also must not
/// be a reason to render an ad in a place nobody approved. Those pull in
/// opposite directions, and each is resolved in the direction that cannot hurt.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_version.dart';
import 'auth_controller.dart';

/// Which student screens may carry a banner, by the app's own names.
enum AdPlacement { qr, menu, plan, more }

class AdsConfig {
  const AdsConfig({
    required this.enabled,
    required this.testMode,
    required this.unitId,
    required this.placements,
  });

  /// Ads off, everywhere. The state whenever anything is unclear.
  const AdsConfig.off()
    : enabled = false,
      testMode = true,
      unitId = null,
      placements = const {};

  final bool enabled;
  final bool testMode;
  final String? unitId;
  final Map<AdPlacement, bool> placements;

  /// Whether this screen shows a banner right now.
  bool showsOn(AdPlacement placement) {
    if (!enabled || unitId == null || unitId!.isEmpty) return false;
    return placements[placement] ?? false;
  }

  static AdsConfig fromJson(Object? raw) {
    if (raw is! Map) return const AdsConfig.off();
    final json = raw.cast<String, dynamic>();

    final enabled = json['enabled'] == true;
    final unitId = json['unitId'];
    // A unit id is what actually makes an ad request possible. Without one
    // there is nothing to show, whatever the flags claim.
    if (!enabled || unitId is! String || unitId.isEmpty) {
      return const AdsConfig.off();
    }

    final rawPlacements = json['placements'];
    final placements = <AdPlacement, bool>{};
    if (rawPlacements is Map) {
      for (final placement in AdPlacement.values) {
        // Only an explicit `true` switches a screen on, so a string or a number
        // arriving in the config cannot turn one on by being truthy.
        placements[placement] = rawPlacements[placement.name] == true;
      }
    }

    return AdsConfig(
      enabled: true,
      testMode: json['testMode'] == true,
      unitId: unitId,
      placements: placements,
    );
  }
}

class RemoteConfig {
  const RemoteConfig({required this.update, required this.ads});

  const RemoteConfig.fallback()
    : update = const UpdateRequirement.none(),
      ads = const AdsConfig.off();

  final UpdateRequirement update;
  final AdsConfig ads;
}

/// Fetched once per launch. Not refreshed while the app is open: a banner that
/// appeared or vanished mid-session would be more alarming than useful, and the
/// next launch is soon enough for a setting nobody is waiting on.
final remoteConfigProvider = FutureProvider<RemoteConfig>((ref) async {
  final platform = defaultTargetPlatform == TargetPlatform.iOS ? 'IOS' : 'ANDROID';

  try {
    final json = await ref
        .read(apiClientProvider)
        .getUnauthenticated('/api/app-config?platform=$platform');

    return RemoteConfig(
      update: updateRequirementFrom(json),
      ads: AdsConfig.fromJson(json['ads']),
    );
  } catch (_) {
    // Nobody blocked, no ads shown.
    return const RemoteConfig.fallback();
  }
});
