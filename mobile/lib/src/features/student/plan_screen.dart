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
import '../../design/theme.dart';
import '../../state/student_providers.dart';
import 'date_label.dart';
import '../../design/components.dart';
import '../../design/motion.dart';
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
            children: staggered([
              if (data.current != null) ...[
                _CurrentPlanCard(subscription: data.current!),
                if (data.current!.isEndingSoon) ...[
                  const Gap.md(),
                  _EndingSoon(subscription: data.current!),
                ],
              ] else
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
            ]),
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
                StatusBadge.forStatus(s.displayState),
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
    final statuses = context.statuses;

    // Deliberately loud. Without a running plan a student cannot eat, so this is
    // the screen's headline rather than a footnote — a grey strip reads as
    // background detail, which is exactly the wrong impression.
    return MessCard(
      color: statuses.statusDanger,
      padding: const EdgeInsets.all(Space.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.no_meals_rounded,
                color: statuses.statusDangerFg,
                size: 22,
              ),
              const Gap.sm(),
              Text(
                'No plan running',
                style: context.texts.titleMedium?.copyWith(
                  color: statuses.statusDangerFg,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const Gap.sm(),
          Text(
            'You cannot be served at the counter until your plan is renewed. '
            'Speak to the mess office — they can start a new one today.',
            style: context.texts.bodyMedium?.copyWith(
              color: statuses.statusDangerFg,
            ),
          ),
        ],
      ),
    );
  }
}

/// The week before a plan lapses.
///
/// Surfaced so a student renews before the day they are turned away at the
/// counter, rather than discovering it in a queue.
class _EndingSoon extends StatelessWidget {
  const _EndingSoon({required this.subscription});

  final StudentSubscription subscription;

  @override
  Widget build(BuildContext context) {
    final statuses = context.statuses;
    final left = subscription.daysRemaining ?? 0;

    return MessCard(
      color: statuses.statusWarning,
      child: Row(
        children: [
          Icon(
            Icons.schedule_rounded,
            color: statuses.statusWarningFg,
            size: 20,
          ),
          const Gap.md(),
          Expanded(
            child: Text(
              left <= 0
                  ? 'Your plan ends today. Renew it to keep eating tomorrow.'
                  : 'Your plan ends in $left ${left == 1 ? 'day' : 'days'}. '
                        'Renew it at the mess office before then.',
              style: context.texts.bodyMedium?.copyWith(
                color: statuses.statusWarningFg,
              ),
            ),
          ),
        ],
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
                StatusBadge.forStatus(s.displayState),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
