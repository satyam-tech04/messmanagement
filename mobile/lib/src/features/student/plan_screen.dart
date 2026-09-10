/// The student's plan, and what they have paid for it.
///
/// Money is integer paise on the wire and formatted only here, with Indian digit
/// grouping — a student checking what they were charged must not read a lakh as
/// a hundred thousand.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/money.dart';
import '../../data/student_models.dart';
import '../../design/async_view.dart';
import '../../design/status_badge.dart';
import '../../state/student_providers.dart';
import 'date_label.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';

class PlanScreen extends ConsumerWidget {
  const PlanScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final plan = ref.watch(studentPlanProvider);

    return plan.when(
      loading: () => ListView(
        padding: const EdgeInsets.all(Space.lg),
        children: const [
          Skeleton(height: 150, radius: Radii.lg),
          Gap.xl(),
          Skeleton(height: 18, width: 140),
          Gap.md(),
          Skeleton(height: 72, radius: Radii.md),
          Gap.sm(),
          Skeleton(height: 72, radius: Radii.md),
        ],
      ),
      error: (e, _) => ErrorState(
        failure: e,
        onRetry: () => ref.invalidate(studentPlanProvider),
      ),
      data: (data) {
        if (data.history.isEmpty) {
          return const EmptyState(
            icon: Icons.card_membership_rounded,
            title: 'No plan yet',
            message:
                'You do not have a meal plan on record. The mess office can start '
                'one for you.',
          );
        }

        final past = data.history
            .where((s) => s.id != data.current?.id)
            .toList();

        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(studentPlanProvider),
          child: ListView(
            padding: Insets.list,
            children: [
              if (data.current != null)
                _CurrentPlanCard(subscription: data.current!)
              else
                const _NoRunningPlan(),
              if (past.isNotEmpty) ...[
                const Gap.xxl(),
                Text(
                  'Earlier plans',
                  style: Theme.of(
                    context,
                  ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                ),
                const Gap.sm(),
                for (final s in past) _HistoryRow(subscription: s),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _CurrentPlanCard extends StatelessWidget {
  const _CurrentPlanCard({required this.subscription});

  final StudentSubscription subscription;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = subscription;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(Space.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    s.planName ?? 'Meal plan',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                StatusBadge.forStatus(s.state),
              ],
            ),
            const Gap.xs(),
            Text(
              '${formatServiceDate(s.startDate)} — ${formatServiceDate(s.endDate)}',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const Divider(height: 28),
            Row(
              children: [
                Expanded(
                  child: _Figure(
                    label: 'You paid',
                    value: formatPaiseCompact(s.pricePaise),
                  ),
                ),
                if (s.perMealPaise != null)
                  Expanded(
                    child: _Figure(
                      label: 'Per meal',
                      value: formatPaise(s.perMealPaise!),
                      // Floored by the server, so the parts can never sum above
                      // what was actually paid.
                      hint: 'approx.',
                    ),
                  ),
              ],
            ),
            const Gap.lg(),
            Text(
              'Covers',
              style: theme.textTheme.labelMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const Gap.sm(),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final slot in s.includedMealSlots)
                  Chip(
                    label: Text(
                      '${slot[0]}${slot.substring(1).toLowerCase()}',
                      style: Theme.of(context).textTheme.labelMedium,
                    ),
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({required this.label, required this.value, this.hint});

  final String label;
  final String value;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: theme.textTheme.labelMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const Gap.xs(),
        Text(
          value,
          style: theme.textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.w700,
            // Tabular so figures line up when read down a column.
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
        if (hint != null)
          Text(
            hint!,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
      ],
    );
  }
}

class _NoRunningPlan extends StatelessWidget {
  const _NoRunningPlan();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      color: theme.colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(Space.lg),
        child: Row(
          children: [
            Icon(
              Icons.info_outline_rounded,
              color: theme.colorScheme.onSurfaceVariant,
            ),
            const Gap.md(),
            Expanded(
              child: Text(
                'No plan is running right now. The mess office can renew it for you.',
                style: theme.textTheme.bodyMedium,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.subscription});

  final StudentSubscription subscription;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = subscription;

    return Card(
      margin: const EdgeInsets.only(bottom: Space.sm),
      child: Padding(
        padding: const EdgeInsets.all(Space.md),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    s.planName ?? 'Meal plan',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const Gap.xs(),
                  Text(
                    formatServiceDateRange(s.startDate, s.endDate),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  formatPaiseCompact(s.pricePaise),
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                ),
                const Gap.xs(),
                StatusBadge.forStatus(s.state),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
