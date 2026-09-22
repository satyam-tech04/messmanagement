/// Push notifications on the device (D-34).
///
/// **Everything here is optional at runtime.** A missing Firebase config makes
/// `Firebase.initializeApp()` throw; that is caught and push simply stays off.
/// A student's app must work identically whether or not the deployment can
/// send notifications, and a counter tablet must never fail to open because a
/// messaging service was unreachable.
///
/// Three problems this file exists to handle, each of which fails silently:
///
///   1. **Android shows nothing while the app is open.** FCM auto-displays only
///      in the background; in the foreground it hands the message over and
///      draws nothing. So the app draws it, on Android only — iOS already
///      presents it, and drawing it too would show everything twice.
///   2. **iOS refuses a token before Apple has issued one.** Asking Firebase
///      too early throws, which is normal on a fresh install. So the APNs token
///      is awaited first, and the refresh listener is attached *before* any of
///      this — if the first attempt still fails, the token that arrives later
///      is registered instead of lost until the next launch.
///   3. **Tokens change quietly.** Registered on every launch and on every
///      refresh, not only when it looks new.
library;

import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/app_info.dart';
import 'auth_controller.dart';
import 'push_logic.dart';

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

/// The channel every notification uses on Android.
///
/// High importance, so it appears as a heads-up banner rather than sliding
/// silently into the tray — an announcement nobody notices is not one.
const _channel = AndroidNotificationChannel(
  androidChannelId,
  'Mess updates',
  description: 'Announcements, away requests, plan reminders and menus.',
  importance: Importance.high,
);

class PushService {
  PushService(this._ref);

  final Ref _ref;
  final _local = FlutterLocalNotificationsPlugin();

  StreamSubscription<String>? _tokenRefresh;
  StreamSubscription<RemoteMessage>? _opened;
  StreamSubscription<RemoteMessage>? _foreground;
  String? _token;
  bool _started = false;

  /// Called once a student is signed in. Never throws.
  Future<void> start() async {
    // Sign-in can call this after a cold-start restore already did. Two sets of
    // listeners would draw every foreground notification twice.
    if (_started) return;

    try {
      await Firebase.initializeApp();
    } catch (error) {
      // No Firebase config compiled in. Not an error worth showing anyone.
      debugPrint('Push disabled: Firebase is not configured ($error)');
      return;
    }
    _started = true;

    try {
      final messaging = FirebaseMessaging.instance;

      // Asked after sign-in, inside the app, so the student has context for
      // the prompt rather than meeting it on first launch before seeing
      // anything. Covers Android 13+'s POST_NOTIFICATIONS prompt too.
      final settings = await messaging.requestPermission();
      final allowed =
          settings.authorizationStatus == AuthorizationStatus.authorized ||
          settings.authorizationStatus == AuthorizationStatus.provisional;
      if (!allowed) return;

      await _prepareDisplay();

      // iOS: shown by the OS even while the app is open. Android ignores this,
      // which is why `_prepareDisplay` and the listener below exist.
      await messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );

      // Attached BEFORE asking for a token. If the first attempt fails — the
      // iOS race — the token that arrives moments later still gets registered
      // here, instead of being lost until the next launch.
      _tokenRefresh = messaging.onTokenRefresh.listen(_register);
      _opened = FirebaseMessaging.onMessageOpenedApp.listen(_handleTap);
      _foreground = FirebaseMessaging.onMessage.listen(_showWhileOpen);

      // A tap that launched the app from cold. Delivered once and only once,
      // so it has to be read now or it is gone.
      final initial = await messaging.getInitialMessage();
      if (initial != null) _handleTap(initial);

      await _registerCurrentToken(messaging);

      _ref.read(pushAvailableProvider.notifier).set(true);
    } catch (error) {
      debugPrint('Push setup failed: $error');
    }
  }

  /// The local-notification plugin and the Android channel.
  ///
  /// Creating the channel here is also what makes the manifest's default
  /// channel id real: FCM uses it for background notifications, but only if a
  /// channel with that id exists on the device.
  Future<void> _prepareDisplay() async {
    await _local.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('ic_stat_notification'),
        // Permission is FirebaseMessaging's job; asking twice would show the
        // student the same prompt twice.
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      ),
      // A tap on a notification the app drew itself, while it was open.
      onDidReceiveNotificationResponse: (response) {
        final payload = response.payload;
        if (payload != null) {
          final route = routeFromData({'route': payload});
          if (route != null) {
            _ref.read(pendingPushRouteProvider.notifier).set(route);
          }
        }
      },
    );

    await _local
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.createNotificationChannel(_channel);
  }

  /// Draws a notification that arrived while the app was open — Android only.
  void _showWhileOpen(RemoteMessage message) {
    if (!showsInForeground(defaultTargetPlatform)) return;

    final notification = message.notification;
    if (notification == null) return;

    unawaited(
      _local.show(
        // Distinct per message, so two arriving together both appear rather
        // than the second replacing the first.
        id: message.messageId?.hashCode ?? DateTime.now().millisecondsSinceEpoch,
        title: notification.title,
        body: notification.body,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(
            _channel.id,
            _channel.name,
            channelDescription: _channel.description,
            importance: Importance.high,
            priority: Priority.high,
            icon: 'ic_stat_notification',
          ),
        ),
        payload: routeFromData(message.data),
      ),
    );
  }

  /// Gets and registers the token, waiting on iOS for Apple to issue its own
  /// first. Failing here is recoverable: the refresh listener is already up.
  Future<void> _registerCurrentToken(FirebaseMessaging messaging) async {
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final apns = await pollUntil<String>(messaging.getAPNSToken);
      if (apns == null) {
        // Apple has not issued one yet. Not fatal: when it does, FCM mints a
        // token and `onTokenRefresh` — already listening — registers it.
        debugPrint('APNs token not ready yet; waiting for a token refresh.');
        return;
      }
    }

    final token = await messaging.getToken();
    if (token != null) await _register(token);
  }

  void _handleTap(RemoteMessage message) {
    final route = routeFromData(message.data);
    if (route != null) {
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
    await _foreground?.cancel();
    _tokenRefresh = null;
    _opened = null;
    _foreground = null;
    _started = false;

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
