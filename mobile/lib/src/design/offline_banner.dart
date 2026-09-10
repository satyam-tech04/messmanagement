/// A strip that says the device has no network.
///
/// Lives in the shell so every screen inherits it rather than each deciding for
/// itself whether to mention connectivity. It states the fact and nothing more:
/// what a given screen can still do while offline differs — the scanner keeps
/// working and queues, a menu cannot load — so the screens say that part.
///
/// It appears and disappears with an animation short enough not to be in the
/// way, because on flaky hostel Wi-Fi this may toggle several times a minute and
/// a banner that slides slowly would be worse than no banner at all.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../state/connectivity.dart';
import 'theme.dart';
import 'tokens.dart';

class OfflineBanner extends ConsumerWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final online = ref.watch(isOnlineProvider);
    final statuses = context.statuses;

    return AnimatedSize(
      duration: Motion.fast,
      curve: Motion.curve,
      alignment: Alignment.topCenter,
      child: online
          ? const SizedBox(width: double.infinity)
          : Container(
              width: double.infinity,
              color: statuses.statusWarning,
              padding: const EdgeInsets.symmetric(
                horizontal: Space.lg,
                vertical: Space.sm,
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.wifi_off_rounded,
                    size: 16,
                    color: statuses.statusWarningFg,
                  ),
                  const SizedBox(width: Space.sm),
                  Text(
                    "You're offline",
                    style: context.texts.labelMedium?.copyWith(
                      color: statuses.statusWarningFg,
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}
