/// Rating the meals you actually ate.
///
/// Only meals attended, only within the lookback window — both decided by the
/// server. Rating a meal you did not eat is noise in a signal the kitchen acts
/// on, and rating one from three weeks ago is a memory rather than a report.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_failure.dart';
import '../../data/student_models.dart';
import '../../design/async_view.dart';
import '../../state/student_providers.dart';
import 'date_label.dart';

class FeedbackScreen extends ConsumerWidget {
  const FeedbackScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feedback = ref.watch(studentFeedbackProvider);

    return feedback.when(
      loading: () => ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          Skeleton(height: 96, radius: 12),
          SizedBox(height: 8),
          Skeleton(height: 96, radius: 12),
          SizedBox(height: 8),
          Skeleton(height: 96, radius: 12),
        ],
      ),
      error: (e, _) => ErrorState(
        failure: e,
        onRetry: () => ref.invalidate(studentFeedbackProvider),
      ),
      data: (data) {
        if (!data.enabled) {
          return const EmptyState(
            icon: Icons.reviews_outlined,
            title: 'Feedback is not being collected',
            message:
                'Your mess has this switched off at the moment. Speak to the mess '
                'office if you want to tell them something.',
          );
        }

        if (data.targets.isEmpty) {
          return const EmptyState(
            icon: Icons.reviews_outlined,
            title: 'Nothing to rate yet',
            message:
                'Meals you have eaten in the last week will appear here so you can '
                'rate them.',
          );
        }

        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(studentFeedbackProvider),
          child: ListView.builder(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            itemCount: data.targets.length,
            itemBuilder: (_, i) => _MealCard(target: data.targets[i]),
          ),
        );
      },
    );
  }
}

class _MealCard extends ConsumerStatefulWidget {
  const _MealCard({required this.target});

  final FeedbackTarget target;

  @override
  ConsumerState<_MealCard> createState() => _MealCardState();
}

class _MealCardState extends ConsumerState<_MealCard> {
  late int? _rating = widget.target.existingRating;
  bool _busy = false;

  Future<void> _rate(int stars) async {
    if (_busy) return;
    // Optimistic: a star that does not fill until a round trip completes feels
    // broken, and the only failure modes here are a disabled feature or a
    // window that has closed — both of which the reload will show.
    setState(() {
      _rating = stars;
      _busy = true;
    });

    final messenger = ScaffoldMessenger.of(context);
    try {
      await submitFeedback(
        ref,
        serviceDate: widget.target.serviceDate,
        mealSlot: widget.target.mealSlot,
        rating: stars,
      );
    } on ApiFailure catch (e) {
      if (mounted) {
        setState(() => _rating = widget.target.existingRating);
        messenger.showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final t = widget.target;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  t.label,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(width: 8),
                Text(
                  formatServiceDate(t.serviceDate),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const Spacer(),
                if (_rating != null)
                  Text(
                    'Rated',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                for (var star = 1; star <= 5; star++)
                  IconButton(
                    // 44px minimum touch target (DESIGN.md), and each star is
                    // individually labelled so a screen reader can act on it.
                    constraints: const BoxConstraints(
                      minWidth: 44,
                      minHeight: 44,
                    ),
                    tooltip: '$star star${star == 1 ? '' : 's'}',
                    onPressed: () => _rate(star),
                    icon: Icon(
                      (_rating ?? 0) >= star
                          ? Icons.star_rounded
                          : Icons.star_border_rounded,
                      size: 30,
                      color: (_rating ?? 0) >= star
                          ? theme.colorScheme.primary
                          : theme.colorScheme.outline,
                    ),
                  ),
              ],
            ),
            if (t.existingComment != null && t.existingComment!.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  t.existingComment!,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
