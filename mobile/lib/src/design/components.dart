/// The pieces every screen is built from.
///
/// If two screens need the same shape, it belongs here. The alternative — each
/// screen assembling its own card, its own section heading, its own figure —
/// is how a product ends up with six subtly different paddings and nobody able
/// to say which is correct.
///
/// Everything below takes its spacing, radii and colours from `tokens.dart` and
/// the theme, so none of it hardcodes a value.
library;

import 'package:flutter/material.dart';

import 'theme.dart';
import 'tokens.dart';

/// A titled block of content.
///
/// The default card in the app: flat, hairline-bordered, padded from the tokens.
class MessCard extends StatelessWidget {
  const MessCard({
    super.key,
    required this.child,
    this.padding = Insets.card,
    this.onTap,
    this.color,
  });

  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final content = Padding(padding: padding, child: child);

    return Card(
      color: color,
      clipBehavior: Clip.antiAlias,
      child: onTap == null ? content : InkWell(onTap: onTap, child: content),
    );
  }
}

/// A heading above a group of rows.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, {super.key, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: Space.md),
    child: Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: context.texts.titleSmall?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        ?trailing,
      ],
    ),
  );
}

/// A label above a number.
///
/// Every figure in the app renders through this, which is what keeps counts,
/// money and totals visually the same thing — and keeps tabular figures on all
/// of them, so a column of numbers does not jitter as it changes.
class Figure extends StatelessWidget {
  const Figure({
    super.key,
    required this.label,
    required this.value,
    this.hint,
    this.emphasis = FigureEmphasis.normal,
    this.align = CrossAxisAlignment.start,
  });

  final String label;
  final String value;
  final String? hint;
  final FigureEmphasis emphasis;
  final CrossAxisAlignment align;

  @override
  Widget build(BuildContext context) {
    final style = switch (emphasis) {
      FigureEmphasis.hero => context.texts.displaySmall,
      FigureEmphasis.normal => context.texts.headlineSmall,
      FigureEmphasis.compact => context.texts.titleMedium,
    };

    return Column(
      crossAxisAlignment: align,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: context.texts.labelMedium?.copyWith(
            color: context.colors.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: Space.xs),
        Text(
          value,
          style: style?.copyWith(
            fontWeight: FontWeight.w800,
            fontFeatures: tabularFigures.fontFeatures,
          ),
        ),
        if (hint != null)
          Text(
            hint!,
            style: context.texts.bodySmall?.copyWith(
              color: context.colors.onSurfaceVariant,
            ),
          ),
      ],
    );
  }
}

enum FigureEmphasis { hero, normal, compact }

/// A pill of supporting text — a meal window, a count, a mode.
class InfoPill extends StatelessWidget {
  const InfoPill({
    super.key,
    required this.label,
    this.icon,
    this.background,
    this.foreground,
  });

  final String label;
  final IconData? icon;
  final Color? background;
  final Color? foreground;

  @override
  Widget build(BuildContext context) {
    final bg = background ?? context.colors.secondaryContainer;
    final fg = foreground ?? context.colors.onSecondaryContainer;

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: Space.md,
        vertical: Space.xs + 2,
      ),
      decoration: BoxDecoration(color: bg, borderRadius: Radii.pillAll),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: fg),
            const SizedBox(width: Space.xs + 2),
          ],
          Text(
            label,
            style: TextStyle(
              color: fg,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// A line of muted supporting text with an icon, used under headings and in
/// status strips.
class HintLine extends StatelessWidget {
  const HintLine(this.text, {super.key, this.icon});

  final String text;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      if (icon != null) ...[
        Icon(icon, size: 16, color: context.colors.onSurfaceVariant),
        const SizedBox(width: Space.xs + 2),
      ],
      Expanded(
        child: Text(
          text,
          style: context.texts.bodySmall?.copyWith(
            color: context.colors.onSurfaceVariant,
          ),
        ),
      ),
    ],
  );
}

/// A message the user must not miss — a form failure, a refusal.
///
/// `liveRegion` so a screen reader announces it: a failure nobody is told about
/// is a form that appears to do nothing.
class Banner extends StatelessWidget {
  const Banner({
    super.key,
    required this.message,
    this.tone = BannerTone.error,
  });

  final String message;
  final BannerTone tone;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, icon) = switch (tone) {
      BannerTone.error => (
        context.colors.errorContainer,
        context.colors.onErrorContainer,
        Icons.error_outline_rounded,
      ),
      BannerTone.info => (
        context.colors.surfaceContainerHighest,
        context.colors.onSurfaceVariant,
        Icons.info_outline_rounded,
      ),
    };

    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(Space.md),
        decoration: BoxDecoration(color: bg, borderRadius: Radii.mdAll),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 20, color: fg),
            const SizedBox(width: Space.sm + 2),
            Expanded(
              child: Text(message, style: TextStyle(color: fg)),
            ),
          ],
        ),
      ),
    );
  }
}

enum BannerTone { error, info }

/// Constrains content on a wide screen so text does not run to absurd line
/// lengths on a tablet — which is exactly what the counter uses.
class ContentColumn extends StatelessWidget {
  const ContentColumn({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: Sizes.maxContentWidth),
      child: child,
    ),
  );
}

/// Vertical space from the scale, so a screen never writes `SizedBox(height: 13)`.
class Gap extends StatelessWidget {
  const Gap.xs({super.key}) : _size = Space.xs;
  const Gap.sm({super.key}) : _size = Space.sm;
  const Gap.md({super.key}) : _size = Space.md;
  const Gap.lg({super.key}) : _size = Space.lg;
  const Gap.xl({super.key}) : _size = Space.xl;
  const Gap.xxl({super.key}) : _size = Space.xxl;
  const Gap.xxxl({super.key}) : _size = Space.xxxl;

  final double _size;

  @override
  Widget build(BuildContext context) => SizedBox(height: _size, width: _size);
}
