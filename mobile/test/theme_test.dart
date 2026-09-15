import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mealadda/src/design/theme.dart';

/// The app wears the same Aurora Depth palette as the web: Indigo in light,
/// Teal in dark.
///
/// These are exact values on purpose. A seed-derived scheme drifts a few
/// shades from the brand every Flutter release, and the whole point of the
/// revamp is that the phone in a student's hand and the admin's browser are
/// visibly one product.
void main() {
  group('light — Cool Mist & Indigo', () {
    final theme = messLightTheme();

    test('uses the indigo accent and mist ground', () {
      expect(theme.colorScheme.brightness, Brightness.light);
      expect(theme.colorScheme.primary, const Color(0xFF3B3FA1));
      expect(theme.colorScheme.onPrimary, const Color(0xFFF4F5FF));
      expect(theme.scaffoldBackgroundColor, const Color(0xFFEEF1F6));
      expect(theme.colorScheme.onSurface, const Color(0xFF141728));
    });

    test('carries the aurora extension with the indigo gradient', () {
      final aurora = theme.extension<AuroraColors>()!;
      expect(aurora.accent1, const Color(0xFF3B3FA1));
      expect(aurora.accent2, const Color(0xFF6A6FD6));
    });
  });

  group('dark — Obsidian Teal', () {
    final theme = messDarkTheme();

    test('uses the teal accent and obsidian ground', () {
      expect(theme.colorScheme.brightness, Brightness.dark);
      expect(theme.colorScheme.primary, const Color(0xFF5FD0C4));
      expect(theme.colorScheme.onPrimary, const Color(0xFF04171A));
      expect(theme.scaffoldBackgroundColor, const Color(0xFF05070A));
      expect(theme.colorScheme.onSurface, const Color(0xFFEDF2F4));
    });

    test('carries the aurora extension with the teal-to-blue gradient', () {
      final aurora = theme.extension<AuroraColors>()!;
      expect(aurora.accent1, const Color(0xFF5FD0C4));
      expect(aurora.accent2, const Color(0xFF2F8FD6));
    });
  });

  test('headlines are set in Archivo, body stays in Inter', () {
    // Archivo is the display voice; Inter stays for body and data because a
    // roll number at 14px must not read 1 as l.
    final text = messDarkTheme().textTheme;
    expect(text.displaySmall!.fontFamily, 'Archivo');
    expect(text.headlineMedium!.fontFamily, 'Archivo');
    expect(text.bodyMedium!.fontFamily, 'Inter');
    expect(text.labelLarge!.fontFamily, 'Inter');
  });

  test('status colours stay semantic in both themes, never the brand accent', () {
    // A blocked student must read red whichever theme the counter tablet is in.
    for (final theme in [messLightTheme(), messDarkTheme()]) {
      final statuses = theme.extension<MessColors>()!;
      expect(statuses.statusDangerFg, isNot(theme.colorScheme.primary));
      expect(statuses.statusActiveFg, isNot(theme.colorScheme.primary));
    }
  });
}
