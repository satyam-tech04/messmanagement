/// The next few days of meals.
///
/// Dates and windows come from the server already resolved in the mess's
/// timezone. Nothing here re-derives a date from the device clock — a student
/// travelling must still see the mess's own days (rule 9).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/student_models.dart';
import '../../design/async_view.dart';
import '../../design/motion.dart';
import '../../state/student_providers.dart';
import 'date_label.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';

class MenuScreen extends ConsumerWidget {
  const MenuScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final menu = ref.watch(studentMenuProvider);

    return menu.when(
      loading: () => const _MenuSkeleton(),
      error: (e, _) => ErrorState(
        failure: e,
        onRetry: () => ref.invalidate(studentMenuProvider),
      ),
      data: (days) {
        final hasAnything = days.any(
          (d) => d.slots.any((s) => s.items.isNotEmpty),
        );
        if (!hasAnything) {
          return const EmptyState(
            icon: Icons.restaurant_menu_rounded,
            title: 'No menu published yet',
            message:
                'The mess has not put up the next few days yet. Check back later, '
                'or ask at the counter what is being served.',
          );
        }

        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(studentMenuProvider),
          child: ListView.builder(
            padding: Insets.list,
            itemCount: days.length,
            // Delay by position rather than by build order: a rebuilt row must
            // not re-animate, and `itemBuilder` is called again on scroll.
            itemBuilder: (_, i) => FadeInUp(
              delay: Duration(milliseconds: 40 * (i < 4 ? i : 4)),
              child: _DayCard(day: days[i]),
            ),
          ),
        );
      },
    );
  }
}

class _DayCard extends StatelessWidget {
  const _DayCard({required this.day});

  final MenuDay day;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: Space.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                day.isToday ? 'Today' : formatServiceDate(day.serviceDate),
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (day.isToday) ...[
                const Gap.sm(),
                Text(
                  formatServiceDate(day.serviceDate),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ],
          ),
          const Gap.sm(),
          for (final slot in day.slots) _SlotRow(slot: slot),
        ],
      ),
    );
  }
}

class _SlotRow extends StatelessWidget {
  const _SlotRow({required this.slot});

  final MenuSlot slot;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.only(bottom: Space.sm),
      color: slot.servingNow ? theme.colorScheme.secondaryContainer : null,
      child: Padding(
        padding: const EdgeInsets.all(Space.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  slot.label,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (slot.window != null) ...[
                  const Gap.sm(),
                  Text(
                    slot.window!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
                const Spacer(),
                // Text as well as the tinted card: colour is never the only
                // signal (DESIGN.md).
                if (slot.servingNow)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: Space.sm,
                      vertical: Space.xs,
                    ),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primary,
                      borderRadius: BorderRadius.circular(Radii.pill),
                    ),
                    child: Text(
                      'Serving now',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.onPrimary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
              ],
            ),
            const Gap.sm(),
            Text(
              slot.items.isEmpty ? 'Not published yet' : slot.items.join(' · '),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: slot.items.isEmpty
                    ? theme.colorScheme.onSurfaceVariant
                    : null,
                fontStyle: slot.items.isEmpty ? FontStyle.italic : null,
              ),
            ),
            if (slot.notes != null && slot.notes!.isNotEmpty) ...[
              const Gap.sm(),
              Text(
                slot.notes!,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MenuSkeleton extends StatelessWidget {
  const _MenuSkeleton();

  @override
  Widget build(BuildContext context) => ListView(
    padding: Insets.list,
    children: [
      for (var day = 0; day < 3; day++) ...[
        const Skeleton(height: 18, width: 120),
        const Gap.sm(),
        // Sized like the real rows, so nothing jumps when the data lands.
        for (var slot = 0; slot < 2; slot++) ...[
          const Skeleton(height: 84, radius: Radii.md),
          const Gap.sm(),
        ],
        const Gap.md(),
      ],
    ],
  );
}
