/// The ad slot (D-35).
///
/// One widget, placed once in the shell, showing a banner only on the screens
/// the operator has switched on. Nothing is compiled in about *where* ads go —
/// that is a checkbox in the console — so this file is only about doing it
/// safely on the device.
///
/// **Every request is child-directed and non-personalised, for everyone.**
/// Some messes serve students under 18 and the app cannot know any individual's
/// age, so the strictest setting applies to all of them. This is a published
/// commitment, not a default to be relaxed when revenue looks thin.
///
/// **It reserves no space until an ad exists.** A placeholder box that might
/// never fill leaves a hole on the screen; worse, reserving height and then
/// filling it shifts the content under the reader's thumb.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import '../../state/app_config.dart';

/// Initialised once per process, lazily — the SDK is only started when an ad is
/// actually going to be shown, so a deployment with ads off never runs it at
/// all.
Future<void>? _initialisation;

Future<void> _initialiseAds() {
  return _initialisation ??= () async {
    await MobileAds.instance.initialize();
    await MobileAds.instance.updateRequestConfiguration(
      RequestConfiguration(
        // Child treatment for every user, applied unconditionally: see the note
        // at the top of this file. In this SDK version `child` is the single
        // signal that replaces both the old child-directed (COPPA) tag and the
        // under-age-of-consent tag, so it carries both commitments at once.
        ageRestrictedTreatment: AgeRestrictedTreatment.child,
        // General audiences only. A hostel mess app is not a place for
        // gambling, alcohol or mature content.
        maxAdContentRating: MaxAdContentRating.g,
      ),
    );
  }();
}

class AdSlot extends ConsumerStatefulWidget {
  const AdSlot({super.key, required this.placement});

  final AdPlacement placement;

  @override
  ConsumerState<AdSlot> createState() => _AdSlotState();
}

class _AdSlotState extends ConsumerState<AdSlot> {
  BannerAd? _ad;
  bool _loaded = false;
  String? _loadedFor;

  @override
  void dispose() {
    _ad?.dispose();
    super.dispose();
  }

  /// Loads an anchored adaptive banner sized to this device's width.
  ///
  /// Adaptive rather than a fixed 320×50: the height is chosen for the screen,
  /// so the same slot is proportionate on a small phone and not lost on a large
  /// one.
  Future<void> _load(String unitId, bool testMode) async {
    if (_loadedFor == unitId) return;
    _loadedFor = unitId;

    await _initialiseAds();
    if (!mounted) return;

    final width = MediaQuery.sizeOf(context).width.truncate();
    final size = await AdSize.getLargeAnchoredAdaptiveBannerAdSize(width);
    if (size == null || !mounted) return;

    final ad = BannerAd(
      adUnitId: unitId,
      size: size,
      request: const AdRequest(
        // Belt and braces with the request configuration above: this is the
        // per-request form of "do not personalise".
        nonPersonalizedAds: true,
      ),
      listener: BannerAdListener(
        onAdLoaded: (_) {
          if (!mounted) return;
          setState(() => _loaded = true);
        },
        onAdFailedToLoad: (ad, error) {
          // No inventory, no network, a brand-new unit still warming up. All of
          // them mean the same thing to a student: nothing appears. Never an
          // error message — an ad is not something they asked for.
          ad.dispose();
          if (!mounted) return;
          setState(() {
            _ad = null;
            _loaded = false;
            // Cleared so a later rebuild may try again.
            _loadedFor = null;
          });
        },
      ),
    );

    setState(() => _ad = ad);
    unawaited(ad.load());
  }

  @override
  Widget build(BuildContext context) {
    final ads = ref.watch(remoteConfigProvider).asData?.value.ads;

    // Unknown config, ads off, or this screen not switched on: nothing at all,
    // not even a gap.
    if (ads == null || !ads.showsOn(widget.placement)) return const SizedBox.shrink();

    final unitId = ads.unitId!;
    // Scheduled rather than called during build: loading an ad is I/O, and
    // `setState` from inside build is an error.
    unawaited(Future.microtask(() => _load(unitId, ads.testMode)));

    final ad = _ad;
    if (ad == null || !_loaded) return const SizedBox.shrink();

    return SafeArea(
      top: false,
      child: SizedBox(
        width: ad.size.width.toDouble(),
        height: ad.size.height.toDouble(),
        child: AdWidget(ad: ad),
      ),
    );
  }
}
