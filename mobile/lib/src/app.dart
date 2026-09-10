/// The root widget, and the one place that decides which screen a user belongs
/// on.
///
/// Routing is driven entirely by the session, not by navigation calls from
/// screens. A screen that pushed its own route after signing in would be a
/// second decision-maker, and the two would eventually disagree — the classic
/// symptom being a user who lands in the app while still owing the forced
/// password change.
///
/// Note that "still restoring" is a state of its own, distinct from "signed
/// out". Collapsing the two makes the login form flash on every cold start for
/// somebody who is already signed in.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'design/async_view.dart';
import 'design/brand.dart';
import 'design/theme.dart';
import 'features/auth/change_password_screen.dart';
import 'features/auth/login_screen.dart';
import 'features/shell.dart';
import 'state/auth_controller.dart';
import 'state/connectivity.dart';
import 'state/theme_controller.dart';
import 'core/app_info.dart';

class MessOsApp extends ConsumerWidget {
  const MessOsApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Keeps the reconnect bridge alive for the app's lifetime: without a
    // listener the provider is never created and nothing would ever be told
    // that the connection came back.
    ref.watch(cameOnlineProvider);

    final auth = ref.watch(authControllerProvider);

    return MaterialApp(
      title: AppInfo.name,
      debugShowCheckedModeBanner: false,
      theme: messLightTheme(),
      darkTheme: messDarkTheme(),
      // Both schemes are first-class (DESIGN.md), and the choice is the user's:
      // a counter tablet under kitchen lights and a student's phone at 9pm are
      // genuinely different situations. Defaults to the device.
      themeMode: ref.watch(themeModeProvider),
      home: auth.when(
        loading: () => const _Splash(),
        error: (error, _) => Scaffold(
          body: SafeArea(
            child: ErrorState(
              failure: error,
              // A server that is unreachable must not silently sign anyone out
              // — a counter tablet on flaky Wi-Fi would lose its session at the
              // worst possible moment. Offer the retry instead.
              onRetry: () => ref.read(authControllerProvider.notifier).retry(),
            ),
          ),
        ),
        data: (session) {
          if (session == null) return const LoginScreen();
          if (session.mustChangePassword) return const ChangePasswordScreen();
          return AppShell(session: session);
        },
      ),
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const BrandMark(size: 110),
            const SizedBox(height: 28),
            const SizedBox(
              height: 24,
              width: 24,
              child: CircularProgressIndicator(strokeWidth: 2.5),
            ),
          ],
        ),
      ),
    );
  }
}
