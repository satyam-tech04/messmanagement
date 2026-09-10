/// The MessMate theme, in both schemes, built entirely from `tokens.dart`.
///
/// **Changing the look happens here and nowhere else.** A screen never names a
/// colour, a radius or a duration directly — it asks the theme. That is what
/// makes a palette change a one-file edit rather than a search-and-replace
/// across forty widgets, and it is why the brand colour below is a single
/// constant.
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

/// The brand blue, sampled from the logo.
///
/// The single source for the whole scheme: Material derives primary, secondary,
/// surfaces, selection and focus rings from it, which is what keeps the app
/// recognisably the same product as its icon.
const Color kBrandSeed = Color(0xFF0D77FC);

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
  ColorScheme get colors => Theme.of(this).colorScheme;
  TextTheme get texts => Theme.of(this).textTheme;
}

/// The type scale.
///
/// Inter, bundled rather than fetched. Two things make it read as designed
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

  TextStyle style(double size, FontWeight weight, double tracking) => TextStyle(
    fontFamily: family,
    fontSize: size,
    fontWeight: weight,
    letterSpacing: tracking,
    height: size >= 28 ? 1.15 : 1.35,
    color: scheme.onSurface,
  );

  return TextTheme(
    displayLarge: style(48, FontWeight.w800, -1.2),
    displayMedium: style(40, FontWeight.w800, -1.0),
    displaySmall: style(34, FontWeight.w800, -0.8),
    headlineLarge: style(30, FontWeight.w700, -0.6),
    headlineMedium: style(26, FontWeight.w700, -0.5),
    headlineSmall: style(22, FontWeight.w700, -0.4),
    titleLarge: style(20, FontWeight.w700, -0.3),
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

ThemeData _build(Brightness brightness) {
  final scheme = ColorScheme.fromSeed(
    seedColor: kBrandSeed,
    brightness: brightness,
  );
  final statuses = brightness == Brightness.dark
      ? MessColors.dark
      : MessColors.light;

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    extensions: [statuses],
    scaffoldBackgroundColor: scheme.surface,
    fontFamily: 'Inter',
    textTheme: _typography(scheme),

    appBarTheme: AppBarTheme(
      centerTitle: false,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      backgroundColor: scheme.surface,
      titleTextStyle: _typography(scheme).titleLarge,
    ),

    // Flat, bordered cards rather than shadowed ones. At the density this app
    // runs — several cards per screen — stacked shadows turn into visual mud,
    // and a hairline separates just as well.
    cardTheme: CardThemeData(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: scheme.surfaceContainerLow,
      shape: RoundedRectangleBorder(
        borderRadius: Radii.lgAll,
        side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.5)),
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
      fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
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
      backgroundColor: scheme.surface,
      indicatorColor: scheme.secondaryContainer,
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
