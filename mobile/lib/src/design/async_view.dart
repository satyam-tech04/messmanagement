/// The four states every list and screen must design for.
///
/// DESIGN.md: loading (skeletons matching the real row height, never a
/// collapsing spinner), empty (an explanation **and** the action that fixes it),
/// error (what failed, with a retry — never "Something went wrong"), and
/// populated. A screen with a bare "No data" is unfinished work.
///
/// Centralised so the bar is cheap to meet. On the web the equivalent
/// (`data-table.tsx`) is used 73 times across 16 files precisely because it is
/// easier to use than to skip.
library;

import 'package:flutter/material.dart';

import '../core/api_failure.dart';
import 'components.dart';
import 'tokens.dart';

/// A skeleton block sized like the content it stands in for.
///
/// Matching the real height matters: a spinner that collapses to a full list
/// shifts everything under a thumb already moving toward it.
class Skeleton extends StatefulWidget {
  const Skeleton({
    super.key,
    this.height = 16,
    this.width = double.infinity,
    this.radius = Radii.sm,
  });

  final double height;
  final double width;
  final double radius;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: Motion.shimmer,
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.surfaceContainerHighest;
    return FadeTransition(
      opacity: Tween(begin: 0.45, end: 0.85).animate(_controller),
      child: Container(
        height: widget.height,
        width: widget.width,
        decoration: BoxDecoration(
          color: base,
          borderRadius: BorderRadius.circular(widget.radius),
        ),
      ),
    );
  }
}

/// Empty, with the action that resolves it.
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;

  /// Say what would put something here. "No students yet" is a fact; "No
  /// students yet — add your first student" is a screen someone can act on.
  final String message;

  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Space.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: Sizes.stateIcon, color: theme.colorScheme.outline),
            const Gap.lg(),
            Text(
              title,
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const Gap.sm(),
            Text(
              message,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            if (actionLabel != null && onAction != null) ...[
              const Gap.xl(),
              FilledButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}

/// A failure the user can do something about.
class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.failure, this.onRetry});

  final Object failure;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Prefer the server's own words. It writes messages for the person reading
    // them — "Choose your own password before continuing" beats any generic
    // string this widget could invent.
    final message = failure is ApiFailure
        ? (failure as ApiFailure).message
        : 'Could not load this. Check your connection and try again.';
    final offline = failure is ApiFailure && (failure as ApiFailure).isOffline;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Space.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              offline ? Icons.wifi_off_rounded : Icons.error_outline_rounded,
              size: Sizes.stateIcon,
              color: theme.colorScheme.error,
            ),
            const Gap.lg(),
            Text(
              offline ? 'No connection' : 'Something needs attention',
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const Gap.sm(),
            Text(
              message,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            if (onRetry != null) ...[
              const Gap.xl(),
              FilledButton.tonalIcon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Try again'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
