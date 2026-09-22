/// Push notifications on the device (D-34).
///
/// **Everything here is optional at runtime.** Until a Firebase project exists
/// there is no `google-services.json` or `GoogleService-Info.plist`, and
/// `Firebase.initializeApp()` throws. That is caught and push simply stays off:
/// a student's app must work identically whether or not the deployment can
/// send notifications, and a counter tablet must never fail to open because a
/// messaging service was unreachable.
///
/// The token is registered on **every launch**, not only when it changes. FCM
/// reissues tokens quietly, and a token that was never re-registered is a
/// student who silently stops hearing anything — a failure nobody reports,
/// because from their side nothing happened.
library;

import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/app_info.dart';
import 'auth_controller.dart';

/// Where a tapped notification wants the app to go, until the shell takes it.
///
/// A tap can arrive before the shell is on screen — from a cold start, the
/// notification is waiting in `getInitialMessage()` — so it is parked here
/// rather than pushed, and consumed once there is something to navigate.
class PendingPushRoute extends Notifier<String?> {
  @override
  String? build() => null;

  void set(String route) => state = route;

  /// Read once and cleared, so switching tabs by hand afterwards does not get
  /// yanked back to where a notification pointed ten minutes ago.
  String? take() {
    final route = state;
    state = null;
    return route;
  }
}

final pendingPushRouteProvider = NotifierProvider<PendingPushRoute, String?>(
  PendingPushRoute.new,
);

/// Whether push actually came up. Drives the in-app settings screen: offering
/// switches that do nothing is worse than not offering them.
class PushAvailable extends Notifier<bool> {
  @override
  bool build() => false;

  void set(bool value) => state = value;
}

final pushAvailableProvider = NotifierProvider<PushAvailable, bool>(
  PushAvailable.new,
);

class PushService {
  PushService(this._ref);

  final Ref _ref;
  StreamSubscription<String>? _tokenRefresh;
  StreamSubscription<RemoteMessage>? _opened;
  String? _token;

  /// Called once a student is signed in. Never throws.
  Future<void> start() async {
    try {
      await Firebase.initializeApp();
    } catch (error) {
      // No Firebase config compiled in, which is the expected state until the
      // project is created. Not an error worth showing anyone.
      debugPrint('Push disabled: Firebase is not configured ($error)');
      return;
    }

    try {
      final messaging = FirebaseMessaging.instance;

      // iOS shows the system prompt here; Android 13+ shows its own. Asking at
      // this point — after sign-in, inside the app — means the student has
      // context for what they are being asked, rather than a prompt on first
      // launch before they have seen anything.
      final settings = await messaging.requestPermission();
      final allowed =
          settings.authorizationStatus == AuthorizationStatus.authorized ||
          settings.authorizationStatus == AuthorizationStatus.provisional;

      if (!allowed) return;

      // Without this, a notification arriving while the app is open is
      // silently swallowed on iOS.
      await messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );

      final token = await messaging.getToken();
      if (token != null) await _register(token);

      _tokenRefresh = messaging.onTokenRefresh.listen(_register);

      // A tap while the app was backgrounded.
      _opened = FirebaseMessaging.onMessageOpenedApp.listen(_handleTap);

      // A tap that launched the app from cold. This message is delivered once
      // and only once, so it has to be read at startup or it is lost.
      final initial = await messaging.getInitialMessage();
      if (initial != null) _handleTap(initial);

      _ref.read(pushAvailableProvider.notifier).set(true);
    } catch (error) {
      debugPrint('Push setup failed: $error');
    }
  }

  void _handleTap(RemoteMessage message) {
    final route = message.data['route'];
    if (route is String && route.isNotEmpty) {
      _ref.read(pendingPushRouteProvider.notifier).set(route);
    }
  }

  Future<void> _register(String token) async {
    _token = token;
    try {
      await _ref
          .read(apiClientProvider)
          .post(
            '/api/student/devices',
            body: {
              'token': token,
              'platform': defaultTargetPlatform == TargetPlatform.iOS
                  ? 'IOS'
                  : 'ANDROID',
              'appBuild': AppInfo.build,
            },
          );
    } catch (error) {
      // A student whose token did not register still has a working app; they
      // just get no notifications this session, and the next launch retries.
      debugPrint('Could not register for push: $error');
    }
  }

  /// Called on sign-out. The next person to use this phone must not receive
  /// the previous student's notifications.
  Future<void> stop() async {
    await _tokenRefresh?.cancel();
    await _opened?.cancel();
    _tokenRefresh = null;
    _opened = null;

    final token = _token;
    _token = null;
    if (token == null) return;

    try {
      // Told to the server first: deleting the token locally would leave the
      // row behind, still being sent to, pointing at this device.
      await _ref
          .read(apiClientProvider)
          .delete('/api/student/devices', body: {'token': token});
      await FirebaseMessaging.instance.deleteToken();
    } catch (error) {
      debugPrint('Could not unregister push: $error');
    }
  }
}

final pushServiceProvider = Provider<PushService>((ref) => PushService(ref));
