/// The MealAdda theme, in both schemes, built entirely from `tokens.dart`.
///
/// **Changing the look happens here and nowhere else.** A screen never names a
/// colour, a radius or a duration directly — it asks the theme. That is what
/// makes a palette change a one-file edit rather than a search-and-replace
/// across forty widgets, and it is why the brand colour below is a single
/// constant.
///
/// **Aurora Depth.** Light is *Cool Mist & Indigo*, dark is *Obsidian Teal* —
/// the same two palettes the web console uses, as exact values rather than a
/// seed, so a student's phone and the admin's browser are visibly one product.
///
/// The theme follows **our** brand, not the tenant's. A mess uploads its own
/// logo and name and those appear throughout the app, but the product's colours
/// stay constant: a per-tenant palette would mean every contrast pairing had to
/// be re-verified for every hostel that ever signs up, and one of them would
/// eventually pick something unreadable on a counter tablet.
///
/// Status colours are a fixed vocabulary shared with the web app — emerald for
/// active, amber for grace or pending, red for blocked, slate for inactive — and
/// **colour is never the only signal**, because these are read under a serving
/// counter's lighting by people who may have a colour-vision deficiency.
library;

import 'package:flutter/material.dart';

import 'tokens.dart';

/// One Aurora Depth palette. Mirrors the CSS tokens in `src/app/globals.css`.
@immutable
class AuroraPalette {
  const AuroraPalette({
    required this.ground,
    required this.panel,
    required this.raised,
    required this.ink,
    required this.muted,
    required this.line,
    required this.accent1,
    required this.accent2,
    required this.accent3,
    required this.onAccent,
    required this.orb1,
    required this.orb2,
    required this.orb3,
    required this.grid,
    required this.chip,
    required this.chipBorder,
    required this.glow,
    required this.live,
    required this.error,
  });

  final Color ground;
  final Color panel;
  final Color raised;
  final Color ink;
  final Color muted;
  final Color line;
  final Color accent1;
  final Color accent2;
  final Color accent3;
  final Color onAccent;
  final Color orb1;
  final Color orb2;
  final Color orb3;
  final Color grid;
  final Color chip;
  final Color chipBorder;
  final Color glow;
  final Color live;
  final Color error;

  /// Cool Mist & Indigo.
  static const indigo = AuroraPalette(
    ground: Color(0xFFEEF1F6),
    panel: Color(0xFFFFFFFF),
    raised: Color(0xFFE6E9F1),
    ink: Color(0xFF141728),
    muted: Color(0xFF5C6280),
    line: Color(0xFFD6DAE5),
    accent1: Color(0xFF3B3FA1),
    accent2: Color(0xFF6A6FD6),
    accent3: Color(0xFF262A72),
    onAccent: Color(0xFFF4F5FF),
    orb1: Color(0x243B3FA1),
    orb2: Color(0x246A6FD6),
    orb3: Color(0x2E96AADC),
    grid: Color(0x0D141728),
    chip: Color(0x0F3B3FA1),
    chipBorder: Color(0x24141728),
    glow: Color(0x473B3FA1),
    live: Color(0xFF2F7A55),
    error: Color(0xFFC0283A),
  );

  /// Obsidian Teal.
  static const teal = AuroraPalette(
    ground: Color(0xFF05070A),
    panel: Color(0xFF0C1015),
    raised: Color(0xFF121820),
    ink: Color(0xFFEDF2F4),
    muted: Color(0xFF8D9BA5),
    line: Color(0xFF1C2228),
    accent1: Color(0xFF5FD0C4),
    accent2: Color(0xFF2F8FD6),
    accent3: Color(0xFF9FF3E4),
    onAccent: Color(0xFF04171A),
    orb1: Color(0x572F8FD6),
    orb2: Color(0x425FD0C4),
    orb3: Color(0x387C5CFF),
    grid: Color(0x09FFFFFF),
    chip: Color(0x0DFFFFFF),
    chipBorder: Color(0x29FFFFFF),
    glow: Color(0x805FD0C4),
    live: Color(0xFF8CE7AD),
    error: Color(0xFFFF6B7A),
  );
}

/// The aurora colours a widget needs beyond the Material scheme: the gradient
/// pair, the backdrop orbs and grid, and the "live" pulse.
@immutable
class AuroraColors extends ThemeExtension<AuroraColors> {
  const AuroraColors({
    required this.accent1,
    required this.accent2,
    required this.accent3,
    required this.onAccent,
    required this.orb1,
    required this.orb2,
    required this.orb3,
    required this.grid,
    required this.chip,
    required this.chipBorder,
    required this.glow,
    required this.live,
  });

  factory AuroraColors.of(AuroraPalette p) => AuroraColors(
    accent1: p.accent1,
    accent2: p.accent2,
    accent3: p.accent3,
    onAccent: p.onAccent,
    orb1: p.orb1,
    orb2: p.orb2,
    orb3: p.orb3,
    grid: p.grid,
    chip: p.chip,
    chipBorder: p.chipBorder,
    glow: p.glow,
    live: p.live,
  );

  final Color accent1;
  final Color accent2;
  final Color accent3;
  final Color onAccent;
  final Color orb1;
  final Color orb2;
  final Color orb3;
  final Color grid;
  final Color chip;
  final Color chipBorder;
  final Color glow;
  final Color live;

  /// The signature gradient: brand tile, primary actions, headline accents.
  LinearGradient get gradient => LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [accent1, accent2],
  );

  @override
  AuroraColors copyWith() => this;

  @override
  AuroraColors lerp(ThemeExtension<AuroraColors>? other, double t) {
    if (other is! AuroraColors) return this;
    Color l(Color a, Color b) => Color.lerp(a, b, t)!;
    return AuroraColors(
      accent1: l(accent1, other.accent1),
      accent2: l(accent2, other.accent2),
      accent3: l(accent3, other.accent3),
      onAccent: l(onAccent, other.onAccent),
      orb1: l(orb1, other.orb1),
      orb2: l(orb2, other.orb2),
      orb3: l(orb3, other.orb3),
      grid: l(grid, other.grid),
      chip: l(chip, other.chip),
      chipBorder: l(chipBorder, other.chipBorder),
      glow: l(glow, other.glow),
      live: l(live, other.live),
    );
  }
}

/// Status colours, which are semantic rather than brand — a "blocked" red must
/// stay red whatever the brand is.
@immutable
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
    statusWarning: Color(0xFFFFEDD5),
    statusWarningFg: Color(0xFF9A3412),
    statusDanger: Color(0xFFFEE2E2),
    statusDangerFg: Color(0xFF991B1B),
    statusNeutral: Color(0xFFE7E5E4),
    statusNeutralFg: Color(0xFF44403C),
  );

  /// Not the light values dimmed: on a dark surface the container and the text
  /// swap roles, so the fill is the deep tone and the text the bright one. AA
  /// contrast fails if these are merely inverted.
  static const dark = MessColors(
    statusActive: Color(0xFF064E3B),
    statusActiveFg: Color(0xFF6EE7B7),
    statusWarning: Color(0xFF7C2D12),
    statusWarningFg: Color(0xFFFDBA74),
    statusDanger: Color(0xFF7F1D1D),
    statusDangerFg: Color(0xFFFCA5A5),
    statusNeutral: Color(0xFF3F3F46),
    statusNeutralFg: Color(0xFFD4D4D8),
  );

  @override
  MessColors copyWith() => this;

  @override
  MessColors lerp(ThemeExtension<MessColors>? other, double t) {
    if (other is! MessColors) return this;
    return MessColors(
      statusActive: Color.lerp(statusActive, other.statusActive, t)!,
      statusActiveFg: Color.lerp(statusActiveFg, other.statusActiveFg, t)!,
      statusWarning: Color.lerp(statusWarning, other.statusWarning, t)!,
      statusWarningFg: Color.lerp(statusWarningFg, other.statusWarningFg, t)!,
      statusDanger: Color.lerp(statusDanger, other.statusDanger, t)!,
      statusDangerFg: Color.lerp(statusDangerFg, other.statusDangerFg, t)!,
      statusNeutral: Color.lerp(statusNeutral, other.statusNeutral, t)!,
      statusNeutralFg: Color.lerp(statusNeutralFg, other.statusNeutralFg, t)!,
    );
  }
}

/// Reach the status palette without repeating the lookup and the `!`.
extension MessThemeX on BuildContext {
  MessColors get statuses => Theme.of(this).extension<MessColors>()!;
  AuroraColors get aurora => Theme.of(this).extension<AuroraColors>()!;
  ColorScheme get colors => Theme.of(this).colorScheme;
  TextTheme get texts => Theme.of(this).textTheme;
}

/// The type scale.
///
/// Archivo for display and headline sizes — the Aurora Depth voice — and
/// Inter, bundled rather than fetched, for everything read at body size. Two things make it read as designed
/// rather than defaulted, and both are about large text:
///
///  - **Negative tracking on display and headline sizes.** Type set large keeps
///    the letter-spacing it was drawn for at 16px, which looks loose and
///    amateurish. Tightening it is most of the difference between a default
///    theme and a considered one.
///  - **Weight, not size, carries hierarchy** in the dense parts. A counter
///    screen has no room to make things bigger, so 600 against 400 does the work
///    that 20px against 16px would elsewhere.
///
/// Body sizes keep their natural tracking — tightening small text hurts
/// legibility, which at a counter is the whole point.
TextTheme _typography(ColorScheme scheme) {
  const family = 'Inter';
  const display = 'Archivo';

  TextStyle style(
    double size,
    FontWeight weight,
    double tracking, {
    String fontFamily = family,
  }) => TextStyle(
    fontFamily: fontFamily,
    fontSize: size,
    fontWeight: weight,
    letterSpacing: tracking,
    height: size >= 28 ? 1.15 : 1.35,
    color: scheme.onSurface,
  );

  return TextTheme(
    displayLarge: style(48, FontWeight.w900, -1.8, fontFamily: display),
    displayMedium: style(40, FontWeight.w900, -1.4, fontFamily: display),
    displaySmall: style(34, FontWeight.w900, -1.1, fontFamily: display),
    headlineLarge: style(30, FontWeight.w800, -0.8, fontFamily: display),
    headlineMedium: style(26, FontWeight.w800, -0.6, fontFamily: display),
    headlineSmall: style(22, FontWeight.w800, -0.4, fontFamily: display),
    titleLarge: style(20, FontWeight.w800, -0.3, fontFamily: display),
    titleMedium: style(17, FontWeight.w600, -0.2),
    titleSmall: style(15, FontWeight.w600, -0.1),
    bodyLarge: style(16, FontWeight.w400, 0),
    bodyMedium: style(14.5, FontWeight.w400, 0),
    bodySmall: style(
      13,
      FontWeight.w400,
      0,
    ).copyWith(color: scheme.onSurfaceVariant),
    labelLarge: style(15, FontWeight.w600, 0),
    labelMedium: style(12.5, FontWeight.w600, 0.2),
    labelSmall: style(11.5, FontWeight.w600, 0.3),
  );
}

ColorScheme _scheme(AuroraPalette p, Brightness brightness) {
  // Seeded only for the roles the palette does not name (tertiary, inverse,
  // scrim). Every role a screen actually paints is overridden with the exact
  // palette value.
  return ColorScheme.fromSeed(
    seedColor: p.accent1,
    brightness: brightness,
  ).copyWith(
    primary: p.accent1,
    onPrimary: p.onAccent,
    primaryContainer: Color.alphaBlend(p.chip, p.raised),
    onPrimaryContainer: p.accent3,
    secondary: p.accent2,
    onSecondary: p.onAccent,
    secondaryContainer: Color.alphaBlend(
      p.accent1.withValues(alpha: 0.16),
      p.panel,
    ),
    onSecondaryContainer: p.accent3,
    error: p.error,
    surface: p.ground,
    onSurface: p.ink,
    onSurfaceVariant: p.muted,
    surfaceContainerLowest: p.ground,
    surfaceContainerLow: p.panel,
    surfaceContainer: p.panel,
    surfaceContainerHigh: p.raised,
    surfaceContainerHighest: p.raised,
    outline: p.chipBorder,
    outlineVariant: p.line,
  );
}

ThemeData _build(Brightness brightness) {
  final palette = brightness == Brightness.dark
      ? AuroraPalette.teal
      : AuroraPalette.indigo;
  final scheme = _scheme(palette, brightness);
  final statuses = brightness == Brightness.dark
      ? MessColors.dark
      : MessColors.light;

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    extensions: [statuses, AuroraColors.of(palette)],
    scaffoldBackgroundColor: palette.ground,
    fontFamily: 'Inter',
    textTheme: _typography(scheme),

    appBarTheme: AppBarTheme(
      centerTitle: false,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      // Translucent so the aurora backdrop reads through the top of the screen.
      backgroundColor: palette.ground.withValues(alpha: 0.72),
      surfaceTintColor: Colors.transparent,
      titleTextStyle: _typography(scheme).titleLarge,
    ),

    // Flat, bordered cards rather than shadowed ones. At the density this app
    // runs — several cards per screen — stacked shadows turn into visual mud,
    // and a hairline separates just as well.
    cardTheme: CardThemeData(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: palette.panel.withValues(alpha: 0.92),
      shape: RoundedRectangleBorder(
        borderRadius: Radii.lgAll,
        side: BorderSide(color: palette.line),
      ),
    ),

    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(Sizes.buttonHeight),
        shape: const RoundedRectangleBorder(borderRadius: Radii.mdAll),
        textStyle: const TextStyle(
          fontFamily: 'Inter',
          fontSize: 16,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.1,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(Sizes.buttonHeight),
        shape: const RoundedRectangleBorder(borderRadius: Radii.mdAll),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(Sizes.touchTarget, Sizes.touchTarget),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        minimumSize: const Size(Sizes.touchTarget, Sizes.touchTarget),
      ),
    ),

    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: palette.panel.withValues(alpha: 0.7),
      border: const OutlineInputBorder(
        borderRadius: Radii.mdAll,
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: Radii.mdAll,
        borderSide: BorderSide(color: scheme.outlineVariant),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: Radii.mdAll,
        borderSide: BorderSide(color: scheme.primary, width: 2),
      ),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: Space.lg,
        vertical: Space.lg + 2,
      ),
    ),

    chipTheme: ChipThemeData(
      shape: const RoundedRectangleBorder(borderRadius: Radii.pillAll),
      side: BorderSide(color: scheme.outlineVariant),
    ),

    dividerTheme: DividerThemeData(
      color: scheme.outlineVariant.withValues(alpha: 0.6),
      space: Space.xxl,
      thickness: 1,
    ),

    navigationBarTheme: NavigationBarThemeData(
      elevation: 0,
      height: 68,
      backgroundColor: palette.panel.withValues(alpha: 0.94),
      indicatorColor: palette.accent1.withValues(alpha: 0.18),
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
    ),

    bottomSheetTheme: const BottomSheetThemeData(
      showDragHandle: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.xl)),
      ),
    ),

    dialogTheme: const DialogThemeData(
      shape: RoundedRectangleBorder(borderRadius: Radii.lgAll),
    ),

    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: Radii.mdAll),
    ),

    progressIndicatorTheme: ProgressIndicatorThemeData(
      linearTrackColor: scheme.surfaceContainerHighest,
    ),
  );
}

ThemeData messLightTheme() => _build(Brightness.light);
ThemeData messDarkTheme() => _build(Brightness.dark);

/// Digits that line up in a column. Use on anything numeric that is read
/// vertically — counts, money, quantities.
const TextStyle tabularFigures = TextStyle(
  fontFeatures: [FontFeature.tabularFigures()],
);
