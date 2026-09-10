/// The design tokens. **Every** spacing, radius, duration and size in the app
/// comes from here.
///
/// The rule is simple and worth stating because it is easy to erode: a screen
/// must never contain a bare number. `EdgeInsets.all(16)` scattered across forty
/// widgets is forty places to change when the density is wrong, and forty
/// chances for one of them to be 15. Named steps also make a review question
/// answerable — "is this `md` or `lg`?" has an answer; "is this 14 or 16?" does
/// not.
///
/// The scale is a 4pt grid, which is what Material, iOS and every dense data UI
/// already agree on.
library;

import 'package:flutter/widgets.dart';

/// Spacing, on a 4pt grid.
abstract final class Space {
  /// 4 — between a label and the thing it labels.
  static const double xs = 4;

  /// 8 — inside a chip, between stacked list rows.
  static const double sm = 8;

  /// 12 — between related controls.
  static const double md = 12;

  /// 16 — the default gutter, and padding inside a card.
  static const double lg = 16;

  /// 20 — between a card and the next one.
  static const double xl = 20;

  /// 24 — screen padding, and between sections.
  static const double xxl = 24;

  /// 32 — above a primary action, below a hero.
  static const double xxxl = 32;
}

/// Corner radii. Larger elements get larger radii, or they look pinched.
abstract final class Radii {
  /// 8 — chips, badges, small controls.
  static const double sm = 8;

  /// 12 — inputs, list rows, buttons.
  static const double md = 12;

  /// 16 — cards.
  static const double lg = 16;

  /// 20 — sheets, the QR panel.
  static const double xl = 20;

  /// A pill. Deliberately absurd rather than computed, so it stays a pill at
  /// any height.
  static const double pill = 999;

  static const BorderRadius smAll = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius mdAll = BorderRadius.all(Radius.circular(md));
  static const BorderRadius lgAll = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius xlAll = BorderRadius.all(Radius.circular(xl));
  static const BorderRadius pillAll = BorderRadius.all(Radius.circular(pill));
}

/// Motion. Short enough not to be in the way at a counter.
abstract final class Motion {
  /// 120ms — a press, a colour change.
  static const Duration fast = Duration(milliseconds: 120);

  /// 220ms — a sheet, a cross-fade.
  static const Duration normal = Duration(milliseconds: 220);

  /// 1100ms — the skeleton shimmer.
  static const Duration shimmer = Duration(milliseconds: 1100);

  static const Curve curve = Curves.easeOutCubic;
}

/// Fixed sizes that recur.
abstract final class Sizes {
  /// The minimum touch target. DESIGN.md requires 44×44 and this app is used
  /// one-handed by students and by staff holding a tablet in one arm.
  static const double touchTarget = 44;

  /// A full-width primary button.
  static const double buttonHeight = 52;

  /// The largest a content column grows on a wide screen, so text does not run
  /// to absurd line lengths on a tablet.
  static const double maxContentWidth = 520;

  /// Icon in an empty or error state.
  static const double stateIcon = 44;

  /// The brand mark on the login screen.
  static const double brandLarge = 96;
}

/// Type sizes for the counter's result overlay.
///
/// These sit outside the normal text theme on purpose. DESIGN.md requires staff
/// feedback to be **readable from a metre** — a tablet propped by a serving
/// counter, glanced at by someone whose attention is on the student and the
/// queue. That is a stated requirement, not a stylistic choice, and snapping it
/// onto the ordinary scale would quietly delete it.
///
/// Named here rather than typed into the overlay so the requirement has one
/// home and a reviewer can see it is deliberate.
abstract final class CounterText {
  /// The verdict — "Served", "Blocked — unpaid dues".
  static const double verdict = 34;

  /// The student's name, read while checking their face against the photo.
  static const double name = 22;

  /// What to do next. Deliberately close to [name]: it is the line that stops
  /// staff debugging at the counter with a queue behind them.
  static const double action = 17;

  /// The roll number, and the "no photo on file" caution.
  static const double supporting = 16;
  static const double caution = 13;
}

/// Common paddings, so the shape of a screen is declared rather than assembled.
abstract final class Insets {
  static const EdgeInsets screen = EdgeInsets.symmetric(
    horizontal: Space.lg,
    vertical: Space.sm,
  );

  /// A scrolling list: room at the bottom so the last row clears the nav bar.
  static const EdgeInsets list = EdgeInsets.fromLTRB(
    Space.lg,
    Space.sm,
    Space.lg,
    Space.xxl,
  );

  /// A list on a screen with a floating action button, which needs more.
  static const EdgeInsets listWithFab = EdgeInsets.fromLTRB(
    Space.lg,
    Space.sm,
    Space.lg,
    96,
  );

  static const EdgeInsets card = EdgeInsets.all(Space.lg);
  static const EdgeInsets cardTight = EdgeInsets.all(Space.md);

  /// A bottom sheet. The caller adds the keyboard inset.
  static const EdgeInsets sheet = EdgeInsets.fromLTRB(
    Space.xl,
    Space.xl,
    Space.xl,
    Space.xl,
  );
}
