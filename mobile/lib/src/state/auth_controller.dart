/// Who is signed in, and the wiring that answers it.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/api_client.dart';
import '../data/auth_repository.dart';
import '../data/session.dart';
import '../data/token_store.dart';

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    tokens: ref.watch(tokenStoreProvider),
    // A refresh token that no longer works means the session is over. Clearing
    // the controller here is what drops the router to the login screen, from
    // wherever in the app the failing request happened to be made.
    onSessionLost: () =>
        ref.read(authControllerProvider.notifier).forgetSession(),
  );
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    api: ref.watch(apiClientProvider),
    tokens: ref.watch(tokenStoreProvider),
  );
});

/// The session, or null when signed out.
///
/// `AsyncValue` rather than a plain `Session?` because the three states are
/// genuinely different to the router: still restoring (show a splash — never a
/// login form, or a signed-in user sees it flash on every cold start), signed
/// out, and signed in. Collapsing loading into "signed out" is what produces
/// that flash.
class AuthController extends AsyncNotifier<Session?> {
  @override
  Future<Session?> build() => ref.read(authRepositoryProvider).restore();

  Future<void> logIn({
    required String identifier,
    required String password,
  }) async {
    final session = await ref
        .read(authRepositoryProvider)
        .logIn(identifier: identifier, password: password);
    state = AsyncData(session);
  }

  Future<void> changePassword(String password) async {
    final session = await ref
        .read(authRepositoryProvider)
        .changePassword(password);
    state = AsyncData(session);
  }

  Future<void> signOut() async {
    await ref.read(authRepositoryProvider).signOut();
    state = const AsyncData(null);
  }

  /// Drop the session without calling the server — for when the server has
  /// already told us it is gone.
  Future<void> forgetSession() async {
    await ref.read(authRepositoryProvider).signOutLocally();
    state = const AsyncData(null);
  }

  /// Re-run `restore()`, for the retry on the launch-failure screen.
  Future<void> retry() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => ref.read(authRepositoryProvider).restore(),
    );
  }
}

final authControllerProvider = AsyncNotifierProvider<AuthController, Session?>(
  AuthController.new,
);
