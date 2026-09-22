/// Which notifications a student wants (D-34).
///
/// Four switches, because the alternative is one switch: a student annoyed by
/// "tomorrow's menu is up" every evening turns push off at the OS level, and
/// then never hears that their plan has lapsed either. Being able to silence
/// the noisy one is what keeps the useful one arriving.
///
/// Saved on every toggle rather than behind a Save button — there is nothing to
/// get wrong, and a settings screen that loses a change because somebody hit
/// back is a worse failure than a redundant request.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_failure.dart';
import '../../design/async_view.dart';
import '../../design/components.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../state/student_providers.dart';

class NotificationSettingsScreen extends ConsumerWidget {
  const NotificationSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(notificationSettingsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: SafeArea(
        child: settings.when(
          loading: () => ListView(
            padding: const EdgeInsets.all(Space.lg),
            children: const [
              Skeleton(height: 72, radius: Radii.md),
              Gap.md(),
              Skeleton(height: 72, radius: Radii.md),
              Gap.md(),
              Skeleton(height: 72, radius: Radii.md),
            ],
          ),
          error: (e, _) => ErrorState(
            failure: e,
            onRetry: () => ref.invalidate(notificationSettingsProvider),
          ),
          data: (value) {
            if (!value.available) {
              return const EmptyState(
                icon: Icons.notifications_off_outlined,
                title: 'Notifications are not switched on yet',
                message:
                    'Your mess has not enabled notifications. Nothing here to '
                    'change for now — the app works exactly as before.',
              );
            }

            return ListView(
              padding: const EdgeInsets.all(Space.lg),
              children: [
                Text(
                  'Choose what your mess can send to this phone. Everything '
                  'else in the app stays the same.',
                  style: context.texts.bodyMedium?.copyWith(
                    color: context.colors.onSurfaceVariant,
                  ),
                ),
                const Gap.lg(),
                for (final kind in value.kinds)
                  MessCard(
                    padding: const EdgeInsets.symmetric(
                      horizontal: Space.md,
                      vertical: Space.xs,
                    ),
                    child: SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      value: kind.enabled,
                      title: Text(kind.title),
                      subtitle: Text(kind.description),
                      onChanged: (enabled) async {
                        final next = value.kinds
                            .where(
                              (k) => k.kind == kind.kind ? enabled : k.enabled,
                            )
                            .map((k) => k.kind)
                            .toList();

                        try {
                          await saveNotificationSettings(ref, next);
                        } on ApiFailure catch (failure) {
                          if (!context.mounted) return;
                          // Told plainly, and the switch springs back, because
                          // a setting that looks saved and is not is worse
                          // than one that visibly failed.
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(failure.message)),
                          );
                        }
                        ref.invalidate(notificationSettingsProvider);
                      },
                    ),
                  ),
                const Gap.md(),
                Text(
                  'You can also turn notifications off entirely in your '
                  "phone's settings.",
                  style: context.texts.bodySmall?.copyWith(
                    color: context.colors.onSurfaceVariant,
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
