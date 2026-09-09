/// Sign in, change a password, sign out, and re-establish a session on launch.
library;

import '../core/api_failure.dart';
import 'api_client.dart';
import 'session.dart';
import 'token_store.dart';

class AuthRepository {
  AuthRepository({required ApiClient api, required TokenStore tokens})
    : _api = api,
      _tokens = tokens;

  final ApiClient _api;
  final TokenStore _tokens;

  /// @param identifier a student's mobile number, or an email for staff and
  ///   admins. The server decides which it is and resolves a student's number
  ///   to the roll-number address their account actually uses — that lookup
  ///   needs the service role and cannot happen here.
  Future<Session> logIn({
    required String identifier,
    required String password,
  }) async {
    final json = await _api.postUnauthenticated(
      '/api/auth/login',
      body: {'identifier': identifier.trim(), 'password': password},
    );

    final tokens = AuthTokens(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
    );
    await _tokens.write(tokens);
    _api.adopt(tokens);

    return Session.fromJson((json['user'] as Map).cast<String, dynamic>());
  }

  /// The session held on this device, or null.
  ///
  /// Calls `/api/me` rather than trusting the stored token: it may have been
  /// revoked, the tenant suspended or the account disabled since last launch,
  /// and all three must land on the login screen rather than a half-working app.
  Future<Session?> restore() async {
    await _api.loadFromStore();
    if (_api.currentTokens == null) return null;

    try {
      final json = await _api.get('/api/me');
      return Session.fromJson((json['user'] as Map).cast<String, dynamic>());
    } on ApiFailure catch (e) {
      // A user who still owes the password change is genuinely signed in —
      // /api/me refuses them by design. Sending them to login instead would
      // trap them outside the one screen that can clear the flag.
      if (e.needsPasswordChange) {
        return const Session(
          role: UserRole.student,
          fullName: '',
          mustChangePassword: true,
          tenantSlug: '',
          tenantName: '',
          tenantLogoUrl: null,
          timezone: 'Asia/Kolkata',
          isStudent: true,
        );
      }
      if (e.isUnauthenticated) {
        await signOutLocally();
        return null;
      }
      // A server that is down or unreachable must not silently sign anyone out
      // — a counter tablet on flaky Wi-Fi would lose its session at the worst
      // possible moment. Surface it and let the caller offer a retry.
      rethrow;
    }
  }

  Future<Session> changePassword(String password) async {
    final json = await _api.post(
      '/api/auth/change-password',
      body: {'password': password},
    );
    return Session.fromJson((json['user'] as Map).cast<String, dynamic>());
  }

  /// Revokes the refresh token server-side, then clears the device.
  ///
  /// The local clear happens even if the server call fails: a user who taps
  /// Sign out must end up signed out on this device regardless, and the access
  /// token expires within the hour either way.
  Future<void> signOut() async {
    try {
      await _api.post('/api/auth/logout');
    } on ApiFailure {
      // Ignored on purpose — see above.
    } finally {
      await signOutLocally();
    }
  }

  Future<void> signOutLocally() async {
    await _tokens.clear();
    _api.adopt(null);
  }
}
