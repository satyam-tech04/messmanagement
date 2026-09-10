/// Whether this device has a network at all.
///
/// Worth separating from "the request failed" because the two need different
/// words and different behaviour. A student in a basement mess hall with no
/// signal should be told to move, not told the mess server is down; and when
/// their signal returns the app should recover on its own rather than leaving
/// them to find the retry button.
///
/// **This says nothing about the server.** The platform reporting a connection
/// means an interface is up, not that anything is reachable — captive portals,
/// hostel Wi-Fi that has stopped forwarding, and a sleeping serverless function
/// all look "connected" here. So it is used to explain and to trigger recovery,
/// never to decide whether a request is worth making.
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class ConnectivityController extends Notifier<bool> {
  StreamSubscription<List<ConnectivityResult>>? _subscription;

  @override
  bool build() {
    ref.onDispose(() => _subscription?.cancel());

    _subscription = Connectivity().onConnectivityChanged.listen((results) {
      state = _isOnline(results);
    });

    // Optimistic until proven otherwise. Starting "offline" would flash a
    // warning on every launch while the first reading arrives.
    unawaited(_check());
    return true;
  }

  Future<void> _check() async {
    try {
      state = _isOnline(await Connectivity().checkConnectivity());
    } catch (_) {
      // A platform that will not answer is not evidence of being offline.
      state = true;
    }
  }

  static bool _isOnline(List<ConnectivityResult> results) =>
      results.isNotEmpty && !results.contains(ConnectivityResult.none);
}

/// True when the device reports a usable network interface.
final isOnlineProvider = NotifierProvider<ConnectivityController, bool>(
  ConnectivityController.new,
);

/// Fires once each time the device comes back after being offline.
///
/// Screens listen to this to refresh themselves, so a student who walks out of
/// a dead spot finds the app already recovered rather than showing a stale error
/// with a button they have to notice.
final cameOnlineProvider = Provider<void>((ref) {
  ref.listen<bool>(isOnlineProvider, (was, now) {
    if (was == false && now == true) {
      ref.invalidate(reconnectTickProvider);
    }
  });
});

/// Bumped on every reconnection. Watch it to re-run a read.
final reconnectTickProvider = Provider<Object>((ref) => Object());
