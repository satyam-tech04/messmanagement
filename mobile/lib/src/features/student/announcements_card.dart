/// Special-meal notices, on the screen a student actually opens (spec §10).
///
/// Mirrors the web student home's card. Read-only — no acknowledgement, no
/// dismissal, nothing to tap (B4).
///
/// Renders **nothing** while loading, on failure, and when no notice is live.
/// This sits above the meal code: a skeleton or an error panel there would push
/// the one thing the screen exists for down the page, over a notice the student
/// can live without. The spec is explicit that an empty card must not take
/// space either.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/student_models.dart';
import '../../design/components.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../state/student_providers.dart';
import 'date_label.dart';

class AnnouncementsCard extends ConsumerWidget {
  const AnnouncementsCard({super.key, this.spacingBelow = 0});

  /// Space after the card, applied only when it renders — a caller's own gap
  /// would otherwise leave a hole where an absent card would have been.
  final double spacingBelow;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(studentAnnouncementsProvider).value ?? const [];
    if (items.isEmpty) return const SizedBox.shrink();

    final colors = Theme.of(context).extension<MessColors>()!;

    final card = MessCard(
      color: colors.statusWarning,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0) const Gap.lg(),
            _Notice(item: items[i], foreground: colors.statusWarningFg),
          ],
        ],
      ),
    );

    return spacingBelow == 0
        ? card
        : Padding(
            padding: EdgeInsets.only(bottom: spacingBelow),
            child: card,
          );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.item, required this.foreground});

  final Announcement item;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final meta = [
      if (item.serviceDate != null) formatServiceDate(item.serviceDate!),
      if (item.mealSlot != null && item.mealSlot!.isNotEmpty)
        '${item.mealSlot![0]}${item.mealSlot!.substring(1).toLowerCase()}',
    ].join(' · ');

    return Semantics(
      container: true,
      label: 'Special meal',
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.campaign_rounded, size: 22, color: foreground),
          const SizedBox(width: Space.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  style: text.titleMedium?.copyWith(
                    color: foreground,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (meta.isNotEmpty) ...[
                  const Gap.xs(),
                  Text(
                    meta,
                    style: text.bodySmall?.copyWith(
                      color: foreground.withValues(alpha: 0.85),
                    ),
                  ),
                ],
                if (item.body != null) ...[
                  const Gap.sm(),
                  Text(
                    item.body!,
                    style: text.bodyMedium?.copyWith(color: foreground),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
