/// The one way the app talks to the server.
///
/// Three jobs, and each exists because doing it per-call goes wrong:
///
///  1. **Attach the bearer token.** A native client has no cookie jar, so this
///     header is the entire session.
///  2. **Refresh once on a 401, then replay the request.** Access tokens live an
///     hour. Without this a student's app dies mid-queue and they cannot show a
///     code — and the web's fix for this (refresh in `proxy.ts`) does not exist
///     for `/api/*` any more, by design.
///  3. **Turn every error into an [ApiFailure] carrying the server's own
///     domain code**, because the server answers denials with a `code` and
///     unreliable statuses — `/api/qr/verify` returns 200 for a refusal, and
///     `SUBSCRIPTION_PAUSED` arrives as a 400.
library;

import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../core/api_failure.dart';
import '../core/config.dart';
import 'session.dart';
import 'token_store.dart';

/// Called when the session is beyond saving, so the app can drop to login.
typedef OnSessionLost = FutureOr<void> Function();

class ApiClient {
  ApiClient({required TokenStore tokens, OnSessionLost? onSessionLost})
    : _tokens = tokens,
      _onSessionLost = onSessionLost {
    _dio = Dio(
      BaseOptions(
        baseUrl: AppConfig.apiBaseUrl,
        // Generous enough for a slow hostel connection, short enough that a
        // student holding a phone at a counter is told something is wrong
        // rather than watching a spinner.
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 15),
        sendTimeout: const Duration(seconds: 15),
        // Never throw on status: every response is inspected here so a domain
        // denial and a transport failure stay distinguishable.
        validateStatus: (_) => true,
        headers: {'Content-Type': 'application/json'},
      ),
    );
  }

  late final Dio _dio;
  final TokenStore _tokens;
  final OnSessionLost? _onSessionLost;

  AuthTokens? _current;

  /// Guards against a burst of parallel 401s each starting its own refresh and
  /// racing to overwrite the stored token — the loser writes a rotated token
  /// that Supabase has already invalidated, and the session dies.
  Future<AuthTokens?>? _refreshInFlight;

  AuthTokens? get currentTokens => _current;

  void adopt(AuthTokens? tokens) => _current = tokens;

  Future<void> loadFromStore() async => _current = await _tokens.read();

  Future<Map<String, dynamic>> get(String path) => _send('GET', path);

  Future<Map<String, dynamic>> post(String path, {Object? body}) =>
      _send('POST', path, body: body);

  /// Sends without a token and without refresh — for login, where there is no
  /// session yet and a 401 is the answer, not a problem to recover from.
  Future<Map<String, dynamic>> postUnauthenticated(
    String path, {
    Object? body,
  }) async {
    final response = await _raw('POST', path, body: body, token: null);
    return _unwrap(response);
  }

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Object? body,
    bool allowRefresh = true,
  }) async {
    final response = await _raw(
      method,
      path,
      body: body,
      token: _current?.accessToken,
    );

    if (response.statusCode == 401 && allowRefresh && _current != null) {
      final refreshed = await _refresh();
      if (refreshed == null) {
        await _onSessionLost?.call();
        throw const ApiFailure(
          code: 'UNAUTHENTICATED',
          message: 'Sign in again.',
          status: 401,
        );
      }
      // Once only. A second 401 after a successful refresh is the server
      // genuinely refusing this caller, not an expiry, and retrying again would
      // loop.
      return _send(method, path, body: body, allowRefresh: false);
    }

    return _unwrap(response);
  }

  Future<AuthTokens?> _refresh() {
    return _refreshInFlight ??= _doRefresh().whenComplete(() {
      _refreshInFlight = null;
    });
  }

  Future<AuthTokens?> _doRefresh() async {
    final refreshToken = _current?.refreshToken;
    if (refreshToken == null) return null;

    final response = await _raw(
      'POST',
      '/api/auth/refresh',
      body: {'refreshToken': refreshToken},
      token: null,
    );

    if (response.statusCode != 200 || response.data is! Map) {
      // The refresh token is revoked, rotated or expired. Clearing here rather
      // than retrying is what stops the app looping on a dead credential.
      _current = null;
      await _tokens.clear();
      return null;
    }

    final data = (response.data as Map).cast<String, dynamic>();
    final next = AuthTokens(
      accessToken: data['accessToken'] as String,
      refreshToken: data['refreshToken'] as String,
    );
    _current = next;
    await _tokens.write(next);
    return next;
  }

  Future<Response<dynamic>> _raw(
    String method,
    String path, {
    Object? body,
    String? token,
  }) async {
    try {
      return await _dio.request<dynamic>(
        path,
        data: body,
        options: Options(
          method: method,
          headers: token == null ? null : {'Authorization': 'Bearer $token'},
        ),
      );
    } on DioException catch (e) {
      // A transport failure is not a refusal. The counter's scan queue depends
      // on telling them apart: a denial must never be queued for replay, and a
      // dropped connection must never be shown as a denial.
      final plain = switch (e.type) {
        DioExceptionType.connectionTimeout ||
        DioExceptionType.sendTimeout ||
        DioExceptionType.receiveTimeout =>
          'The mess server is slow to answer. Try again.',
        _ => 'No connection to the mess server.',
      };
      throw ApiFailure(
        code: 'NETWORK_ERROR',
        // Same reasoning as the non-JSON branch: in development, "no
        // connection" is nearly always the wrong address rather than a real
        // outage, and the address is the one fact that settles it.
        message: kDebugMode ? '$plain (${AppConfig.apiBaseUrl})' : plain,
      );
    }
  }

  Map<String, dynamic> _unwrap(Response<dynamic> response) {
    final status = response.statusCode ?? 0;
    final data = response.data;

    if (data is! Map) {
      // Not JSON. Two causes, and they look identical without the URL: the
      // request was redirected to an HTML login page (the failure the `/api`
      // proxy exclusion exists to prevent), or the app is pointed at something
      // that is not this server at all — a stale `API_BASE_URL`, or another
      // process on the same port.
      //
      // Naming the address in debug builds turns ten minutes of guessing into
      // one glance. Release builds keep the plain sentence: a student has no
      // use for a hostname.
      throw ApiFailure(
        code: 'INFRASTRUCTURE_ERROR',
        message: kDebugMode
            ? 'Unexpected response from ${AppConfig.apiBaseUrl} '
                  '(HTTP $status, not JSON). Check API_BASE_URL.'
            : 'The mess server sent an unexpected response.',
        status: status,
      );
    }

    final json = data.cast<String, dynamic>();
    final error = json['error'];

    if (error is Map) {
      final e = error.cast<String, dynamic>();
      throw ApiFailure(
        code: e['code'] as String? ?? 'UNKNOWN',
        message: e['message'] as String? ?? 'Something went wrong.',
        status: status,
        details: (e['details'] as Map?)?.cast<String, dynamic>(),
      );
    }

    if (status >= 400) {
      throw ApiFailure(
        code: 'UNKNOWN',
        message: 'Something went wrong.',
        status: status,
      );
    }

    return json;
  }
}
