/// Where the tokens live between launches.
///
/// `flutter_secure_storage` rather than shared preferences: these are bearer
/// credentials for a live account, and on Android the Keystore-backed store
/// survives a rooted-adb-backup in a way plain prefs do not.
///
/// Sessions here deliberately last a year (`session-lifetime.ts`) so a counter
/// tablet rebooting overnight does not strand staff at a login screen with a
/// queue forming at 07:00. That is only an acceptable trade because signing out
/// actually revokes the refresh token server-side — see `/api/auth/logout`.
library;

import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'session.dart';

class TokenStore {
  TokenStore({FlutterSecureStorage? storage})
    : _storage =
          storage ??
          const FlutterSecureStorage(
            // The default is already AES-GCM with RSA-OAEP key wrapping,
            // Keystore-backed. `encryptedSharedPreferences` is deprecated —
            // Google deprecated the Jetpack Security library behind it — and
            // is gone entirely in v11.
            //
            // Pinned to the 10.x line deliberately: v11 hardcodes
            // `compileSdk = 37`, a *preview* Android SDK that AGP cannot even
            // resolve locally (it installs as `android-37.0`) and that Play
            // will not accept as a release target.
            aOptions: AndroidOptions(),
            iOptions: IOSOptions(
              // Readable only after the first unlock following a reboot, and
              // never migrated to a new device by an iCloud restore. A counter
              // tablet must come back signed in after a restart; a session must
              // not travel to different hardware.
              accessibility: KeychainAccessibility.first_unlock_this_device,
            ),
          );

  final FlutterSecureStorage _storage;

  static const _accessKey = 'campusmeals.accessToken';
  static const _refreshKey = 'campusmeals.refreshToken';
  static const _sessionKey = 'campusmeals.session';

  Future<AuthTokens?> read() async {
    try {
      final access = await _storage.read(key: _accessKey);
      final refresh = await _storage.read(key: _refreshKey);
      if (access == null || refresh == null) return null;
      return AuthTokens(accessToken: access, refreshToken: refresh);
    } catch (_) {
      // A keystore that cannot be read is indistinguishable from having no
      // session, and treating it as "signed in" would leave the app stuck
      // retrying with credentials it cannot produce. Fail closed to the login
      // screen (rule 7).
      return null;
    }
  }

  /// The last session this device saw, for drawing the right shell on launch
  /// without waiting for the network.
  ///
  /// **Not a credential and never treated as one.** It decides which shell to
  /// paint while `/api/me` confirms in the background; every actual request is
  /// authorised independently by the token, so a stale copy here can show a
  /// shell for a moment but can never grant access to anything.
  Future<Session?> readCachedSession() async {
    try {
      final raw = await _storage.read(key: _sessionKey);
      if (raw == null) return null;
      return Session.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  Future<void> cacheSession(Session session) async {
    try {
      await _storage.write(
        key: _sessionKey,
        value: jsonEncode(session.toJson()),
      );
    } catch (_) {
      // A cache that cannot be written costs a splash, not a session.
    }
  }

  Future<void> write(AuthTokens tokens) async {
    await _storage.write(key: _accessKey, value: tokens.accessToken);
    await _storage.write(key: _refreshKey, value: tokens.refreshToken);
  }

  Future<void> clear() async {
    // Deleted independently so a failure on the first still attempts the
    // second — a half-cleared store that keeps a live refresh token is the one
    // outcome sign-out must never produce.
    try {
      await _storage.delete(key: _accessKey);
      await _storage.delete(key: _sessionKey);
    } finally {
      await _storage.delete(key: _refreshKey);
    }
  }
}
