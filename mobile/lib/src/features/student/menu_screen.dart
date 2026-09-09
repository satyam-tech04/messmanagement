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
import '../../state/student_providers.dart';
import 'date_label.dart';

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
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            itemCount: days.length,
            itemBuilder: (_, i) => _DayCard(day: days[i]),
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
      padding: const EdgeInsets.only(bottom: 20),
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
                const SizedBox(width: 8),
                Text(
                  formatServiceDate(day.serviceDate),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 10),
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
      margin: const EdgeInsets.only(bottom: 8),
      color: slot.servingNow ? theme.colorScheme.secondaryContainer : null,
      child: Padding(
        padding: const EdgeInsets.all(14),
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
                  const SizedBox(width: 8),
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
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primary,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      'Serving now',
                      style: TextStyle(
                        color: theme.colorScheme.onPrimary,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),
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
              const SizedBox(height: 6),
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
    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
    children: [
      for (var day = 0; day < 3; day++) ...[
        const Skeleton(height: 18, width: 120),
        const SizedBox(height: 10),
        // Sized like the real rows, so nothing jumps when the data lands.
        for (var slot = 0; slot < 2; slot++) ...[
          const Skeleton(height: 84, radius: 12),
          const SizedBox(height: 8),
        ],
        const SizedBox(height: 12),
      ],
    ],
  );
}
