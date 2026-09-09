/// The MessOS theme, in both schemes.
///
/// DESIGN.md is enforced, not aspirational: light and dark are both first-class
/// and no screen ships checked in only one. The status colours below are a fixed
/// vocabulary shared with the web app — emerald for active, amber for grace or
/// pending, red for blocked, slate for inactive — and **colour is never the only
/// signal**, because a counter tablet gets used under bad lighting by people who
/// may have a colour-vision deficiency. Every badge carries text too.
///
/// Touch targets are 44×44 minimum. That is not a guideline here: the student
/// surface is used one-handed, and the staff surface by someone holding a
/// tablet in one arm during a rush.
library;

import 'package:flutter/material.dart';

class MessColors extends ThemeExtension<MessColors> {
  const MessColors({
    required this.statusActive,
    required this.statusActiveFg,
    required this.statusWarning,
    required this.statusWarningFg,
    required this.statusDanger,
    required this.statusDangerFg,
    required this.statusNeutral,
    required this.statusNeutralFg,
  });

  final Color statusActive;
  final Color statusActiveFg;
  final Color statusWarning;
  final Color statusWarningFg;
  final Color statusDanger;
  final Color statusDangerFg;
  final Color statusNeutral;
  final Color statusNeutralFg;

  static const light = MessColors(
    statusActive: Color(0xFFD1FAE5),
    statusActiveFg: Color(0xFF065F46),
    statusWarning: Color(0xFFFEF3C7),
    statusWarningFg: Color(0xFF92400E),
    statusDanger: Color(0xFFFEE2E2),
    statusDangerFg: Color(0xFF991B1B),
    statusNeutral: Color(0xFFE2E8F0),
    statusNeutralFg: Color(0xFF334155),
  );

  static const dark = MessColors(
    statusActive: Color(0xFF064E3B),
    statusActiveFg: Color(0xFF6EE7B7),
    statusWarning: Color(0xFF78350F),
    statusWarningFg: Color(0xFFFCD34D),
    statusDanger: Color(0xFF7F1D1D),
    statusDangerFg: Color(0xFFFCA5A5),
    statusNeutral: Color(0xFF334155),
    statusNeutralFg: Color(0xFFCBD5E1),
  );

  @override
  MessColors copyWith() => this;

  @override
  MessColors lerp(ThemeExtension<MessColors>? other, double t) {
    if (other is! MessColors) return this;
    return t < 0.5 ? this : other;
  }
}

/// The brand blue, sampled from the logo, and the one place a seed colour is
/// chosen so both schemes stay in step.
///
/// Material derives the whole scheme from this, which is what keeps buttons,
/// selection and focus rings recognisably the same product as the mark on the
/// icon rather than merely nearby.
const _seed = Color(0xFF0D77FC);

ThemeData _base(Brightness brightness, MessColors statuses) {
  final scheme = ColorScheme.fromSeed(
    seedColor: _seed,
    brightness: brightness,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    extensions: [statuses],
    // Money and counts are read in columns and compared. Tabular figures stop
    // digits shifting position between rows, which is what makes a column
    // scannable rather than merely present.
    textTheme: const TextTheme().apply(fontFamilyFallback: const ['monospace']),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: 16,
        vertical: 18,
      ),
    ),
    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
    ),
  );
}

ThemeData messLightTheme() => _base(Brightness.light, MessColors.light);
ThemeData messDarkTheme() => _base(Brightness.dark, MessColors.dark);

/// Digits that line up in a column. Use on anything numeric.
const tabularFigures = TextStyle(
  fontFeatures: [FontFeature.tabularFigures()],
);
