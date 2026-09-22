import 'package:flutter_test/flutter_test.dart';
import 'package:mealadda/src/state/app_config.dart';

/// Whether a banner appears on a screen (D-35).
///
/// This decides what reaches a student's screen from a server response, so
/// every case below is about the response being wrong, missing or half-filled
/// — and the answer being "no ad" in all of them. A missing ad costs a fraction
/// of a rupee; an ad in the wrong place risks the AdMob account.
void main() {
  const unit = 'ca-app-pub-3940256099942544/9214589741';

  Map<String, dynamic> ads({
    bool enabled = true,
    Object? unitId = unit,
    Object? placements = const {
      'qr': false,
      'menu': true,
      'plan': true,
      'more': true,
    },
  }) => {
    'enabled': enabled,
    'testMode': true,
    'unitId': unitId,
    'placements': placements,
  };

  test('shows a banner on the screens that are switched on', () {
    final config = AdsConfig.fromJson(ads());
    expect(config.showsOn(AdPlacement.menu), isTrue);
    expect(config.showsOn(AdPlacement.plan), isTrue);
    expect(config.showsOn(AdPlacement.more), isTrue);
  });

  test('keeps the meal code clear when it is switched off', () {
    // The screen held up at the counter while staff scan it.
    expect(AdsConfig.fromJson(ads()).showsOn(AdPlacement.qr), isFalse);
  });

  test('shows nothing anywhere when ads are off', () {
    final config = AdsConfig.fromJson(ads(enabled: false));
    for (final placement in AdPlacement.values) {
      expect(config.showsOn(placement), isFalse);
    }
  });

  test('shows nothing without a unit id, whatever the flags say', () {
    // A unit id is what makes an ad request possible at all.
    for (final unitId in [null, '', 42]) {
      final config = AdsConfig.fromJson(ads(unitId: unitId));
      expect(config.showsOn(AdPlacement.menu), isFalse);
    }
  });

  test('only an explicit true switches a screen on', () {
    final config = AdsConfig.fromJson(
      ads(placements: {'menu': 'yes', 'plan': 1, 'more': null, 'qr': true}),
    );
    expect(config.showsOn(AdPlacement.menu), isFalse);
    expect(config.showsOn(AdPlacement.plan), isFalse);
    expect(config.showsOn(AdPlacement.more), isFalse);
    expect(config.showsOn(AdPlacement.qr), isTrue);
  });

  test('survives a response with no ads block, or rubbish in it', () {
    // The whole config is fetched from the network before a student has
    // signed in. Anything unexpected here means no ads, never a crash.
    for (final raw in <Object?>[null, 'on', 42, <String, dynamic>{}, []]) {
      final config = AdsConfig.fromJson(raw);
      for (final placement in AdPlacement.values) {
        expect(config.showsOn(placement), isFalse);
      }
    }
  });

  test('a placements block that is not a map switches nothing on', () {
    final config = AdsConfig.fromJson(ads(placements: ['menu', 'plan']));
    expect(config.showsOn(AdPlacement.menu), isFalse);
  });
}
