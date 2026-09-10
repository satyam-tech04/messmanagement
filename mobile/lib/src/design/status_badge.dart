/// A status, shown as colour **and** text.
///
/// DESIGN.md is explicit that colour is never the only signal. Two reasons, both
/// practical rather than theoretical: colour-vision deficiency is common, and
/// the staff surface is read on a tablet under a serving counter's lighting. A
/// green dot alone is not a status; "Active" in a green pill is.
library;

import 'package:flutter/material.dart';

import 'theme.dart';
import 'tokens.dart';

enum StatusTone { active, warning, danger, neutral }

/// The fixed vocabulary, shared with the web app's `status-badge.tsx`.
///
/// Unknown values fall to [StatusTone.neutral] rather than throwing — a server
/// that adds a status must not blank a screen on an older build.
StatusTone toneForStatus(String status) => switch (status.toUpperCase()) {
  'ACTIVE' ||
  'PAID' ||
  'APPROVED' ||
  'SERVED' ||
  'RUNNING' => StatusTone.active,
  'GRACE' || 'PENDING' || 'PAUSED' => StatusTone.warning,
  'BLOCKED' || 'OVERDUE' || 'REJECTED' || 'DENIED' => StatusTone.danger,
  _ => StatusTone.neutral,
};

class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.label, required this.tone});

  StatusBadge.forStatus(String status, {super.key})
    : label = _humanise(status),
      tone = toneForStatus(status);

  final String label;
  final StatusTone tone;

  static String _humanise(String status) {
    final words = status.toLowerCase().replaceAll('_', ' ');
    return words.isEmpty
        ? words
        : '${words[0].toUpperCase()}${words.substring(1)}';
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<MessColors>()!;
    final (background, foreground) = switch (tone) {
      StatusTone.active => (colors.statusActive, colors.statusActiveFg),
      StatusTone.warning => (colors.statusWarning, colors.statusWarningFg),
      StatusTone.danger => (colors.statusDanger, colors.statusDangerFg),
      StatusTone.neutral => (colors.statusNeutral, colors.statusNeutralFg),
    };

    return Semantics(
      // Announced as a status, so a screen reader does not read it as a
      // decorative label detached from what it describes.
      label: 'Status: $label',
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: Space.sm + 2,
          vertical: Space.xs,
        ),
        decoration: BoxDecoration(
          color: background,
          borderRadius: Radii.pillAll,
        ),
        child: Text(
          label,
          style: TextStyle(
            color: foreground,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
