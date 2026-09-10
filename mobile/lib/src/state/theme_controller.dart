/// Which scheme the app renders in.
///
/// Three states, not two. "System" is the default and the one most people want,
/// but a counter tablet living under bright kitchen lights and a student's phone
/// at 9pm are genuinely different situations, so an explicit choice has to be
/// available and has to survive a restart.
///
/// Persisted with the same `shared_preferences` the scan queue already uses —
/// this is a per-device display preference, not part of the session, and it must
/// not vanish when somebody signs out.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _key = 'mealadda.themeMode';

class ThemeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    _restore();
    // Follow the device until told otherwise. Reading the stored value is
    // asynchronous, and defaulting to `system` means the first frame matches
    // what the phone is already doing rather than flashing the wrong scheme.
    return ThemeMode.system;
  }

  Future<void> _restore() async {
    try {
      final stored = (await SharedPreferences.getInstance()).getString(_key);
      final mode = ThemeMode.values.asNameMap()[stored];
      if (mode != null) state = mode;
    } catch (_) {
      // A preference that cannot be read is not worth failing over; the device
      // setting is a perfectly good answer.
    }
  }

  Future<void> set(ThemeMode mode) async {
    state = mode;
    try {
      await (await SharedPreferences.getInstance()).setString(_key, mode.name);
    } catch (_) {
      // Applied for this run even if it could not be saved.
    }
  }
}

final themeModeProvider = NotifierProvider<ThemeController, ThemeMode>(
  ThemeController.new,
);

/// What to call each option in a menu.
String themeModeLabel(ThemeMode mode) => switch (mode) {
  ThemeMode.system => 'Match device',
  ThemeMode.light => 'Light',
  ThemeMode.dark => 'Dark',
};

IconData themeModeIcon(ThemeMode mode) => switch (mode) {
  ThemeMode.system => Icons.brightness_auto_rounded,
  ThemeMode.light => Icons.light_mode_rounded,
  ThemeMode.dark => Icons.dark_mode_rounded,
};
