import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mealadda/src/state/push_logic.dart';

/// The parts of push that decide what a student sees, testable without a
/// device or Firebase.
///
/// Each case here is a bug that shipped once already, or would have: a
/// notification swallowed because the app was open, one shown twice, and a
/// phone that never registered because it asked Apple too early.
void main() {
  group('showing a notification while the app is open', () {
    test('Android has to draw it itself', () {
      // FCM only auto-displays in the background. In the foreground it hands
      // the message to the app and shows nothing — a student with the app open
      // would never see the announcement.
      expect(showsInForeground(TargetPlatform.android), isTrue);
    });

    test('iOS does not, or it would appear twice', () {
      // iOS already presents it, via the foreground presentation options.
      // Drawing a second one locally would show every notification twice.
      expect(showsInForeground(TargetPlatform.iOS), isFalse);
    });
  });

  group('where a tap goes', () {
    test('reads the route the server sent', () {
      expect(routeFromData({'route': '/menu', 'kind': 'MENU_PUBLISHED'}), '/menu');
    });

    test('ignores a missing, empty or non-string route', () {
      // The payload came off the network. Anything unexpected means "open the
      // app where it was", never a crash.
      for (final data in <Map<String, dynamic>>[
        {},
        {'route': ''},
        {'route': 42},
        {'route': null},
      ]) {
        expect(routeFromData(data), isNull);
      }
    });

    test('refuses anything that is not an in-app path', () {
      // A route is looked up in a fixed table, but a URL or a scheme here is
      // somebody trying something, and it should go nowhere.
      for (final route in ['https://evil.example', 'javascript:x', 'menu']) {
        expect(routeFromData({'route': route}), isNull);
      }
    });
  });

  group('waiting for Apple before asking Firebase', () {
    test('returns the value as soon as it exists', () async {
      var calls = 0;
      final value = await pollUntil<String>(
        () async => ++calls >= 3 ? 'apns-token' : null,
        attempts: 10,
        interval: Duration.zero,
      );

      expect(value, 'apns-token');
      expect(calls, 3);
    });

    test('gives up after the attempts, rather than hanging the app', () async {
      var calls = 0;
      final value = await pollUntil<String>(
        () async {
          calls++;
          return null;
        },
        attempts: 4,
        interval: Duration.zero,
      );

      expect(value, isNull);
      expect(calls, 4);
    });

    test('treats a throwing probe as "not yet", not as fatal', () async {
      // `getAPNSToken` can throw on a device that has not finished
      // registering. That is the case being waited out, not a failure.
      var calls = 0;
      final value = await pollUntil<String>(
        () async {
          if (++calls < 2) throw StateError('not ready');
          return 'apns-token';
        },
        attempts: 5,
        interval: Duration.zero,
      );

      expect(value, 'apns-token');
    });
  });
}
