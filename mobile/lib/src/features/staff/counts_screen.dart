/// Projected against served, per meal.
///
/// The number the kitchen cooks to, and how far through it the counter is. Read
/// standing up, at a glance, so the figures are large and the bars carry the
/// same information as the numbers for anyone who cannot read them quickly.
///
/// A **locked** projection is called out. Once the cron locks it, that is what
/// the mess actually bought for, and it stops moving even as subscriptions
/// change — staff reconciling a shortfall need to know which of the two numbers
/// is the fixed one.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/attendance_watcher.dart';
import '../../data/session.dart';
import '../../data/staff_models.dart';
import '../../design/async_view.dart';
import '../../state/auth_controller.dart';
import '../../state/staff_providers.dart';

class CountsScreen extends ConsumerStatefulWidget {
  const CountsScreen({super.key, required this.session});

  final Session session;

  @override
  ConsumerState<CountsScreen> createState() => _CountsScreenState();
}

class _CountsScreenState extends ConsumerState<CountsScreen> {
  final _watcher = AttendanceWatcher();
  bool _live = false;

  @override
  void initState() {
    super.initState();
    _subscribe();
  }

  @override
  void dispose() {
    _watcher.stop();
    super.dispose();
  }

  Future<void> _subscribe() async {
    final token = ref.read(apiClientProvider).currentTokens?.accessToken;
    if (token == null) return;

    // Today in the mess's timezone comes from the server with the counts; until
    // they arrive there is nothing to watch, so this runs after the first read.
    final counts = await ref.read(staffCountsProvider.future);
    if (!mounted || counts.serviceDate.isEmpty) return;

    try {
      await _watcher.watchTenant(
        accessToken: token,
        serviceDate: counts.serviceDate,
        onServed: () {
          // Re-read rather than incrementing a local tally: the projection can
          // move too, and a screen the kitchen trusts must not drift from what
          // the server would say.
          if (mounted) ref.invalidate(staffCountsProvider);
        },
      );
      if (mounted) setState(() => _live = true);
    } catch (_) {
      // The socket is an accelerator. Pull-to-refresh still works without it,
      // and the indicator below says plainly which mode the screen is in.
    }
  }

  @override
  Widget build(BuildContext context) {
    final counts = ref.watch(staffCountsProvider);

    return counts.when(
      loading: () => ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          Skeleton(height: 110, radius: 16),
          SizedBox(height: 10),
          Skeleton(height: 110, radius: 16),
          SizedBox(height: 10),
          Skeleton(height: 110, radius: 16),
        ],
      ),
      error: (e, _) => ErrorState(
        failure: e,
        onRetry: () => ref.invalidate(staffCountsProvider),
      ),
      data: (counts) {
        final slots = counts.slots;
        if (slots.isEmpty) {
          return const EmptyState(
            icon: Icons.groups_rounded,
            title: 'No meals configured',
            message: 'Ask the mess admin to set up meal times before serving.',
          );
        }

        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(staffCountsProvider),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            children: [
              _LiveIndicator(live: _live),
              const SizedBox(height: 12),
              for (final slot in slots) _SlotCard(slot: slot),
            ],
          ),
        );
      },
    );
  }
}

class _LiveIndicator extends StatelessWidget {
  const _LiveIndicator({required this.live});

  final bool live;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Icon(
          live ? Icons.podcasts_rounded : Icons.refresh_rounded,
          size: 16,
          color: theme.colorScheme.onSurfaceVariant,
        ),
        const SizedBox(width: 6),
        // Said in words, not only by a coloured dot: staff need to know whether
        // what they are looking at updates itself.
        Text(
          live ? 'Updating live' : 'Pull down to refresh',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

class _SlotCard extends StatelessWidget {
  const _SlotCard({required this.slot});

  final SlotCount slot;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final progress = slot.projected == 0
        ? 0.0
        : (slot.served / slot.projected).clamp(0.0, 1.0);

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  slot.label,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const Spacer(),
                if (slot.locked)
                  Tooltip(
                    message:
                        'The kitchen has already bought for this count, so it no '
                        'longer moves.',
                    child: Row(
                      children: [
                        Icon(
                          Icons.lock_outline_rounded,
                          size: 14,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          'Locked',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  '${slot.served}',
                  style: theme.textTheme.displaySmall?.copyWith(
                    fontWeight: FontWeight.w800,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(bottom: 6, left: 4),
                  child: Text(
                    'of ${slot.projected}',
                    style: theme.textTheme.titleMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ),
                const Spacer(),
                Text(
                  '${slot.remaining} left',
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: LinearProgressIndicator(
                value: progress,
                minHeight: 10,
                backgroundColor: theme.colorScheme.surfaceContainerHighest,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
