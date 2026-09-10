import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'src/app.dart';
import 'src/core/config.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  AppConfig.assertConfigured();

  // The only thing worth blocking the first frame for. It reads bundled locale
  // data rather than the network, and without it the first render of any date
  // or amount would be in the wrong format — `en_IN` is what puts the
  // separators in the lakh and crore positions.
  await initializeDateFormatting('en_IN');

  // Supabase is **not** initialised here. It used to be, and every cold start
  // paid for it before a pixel was drawn, on a screen that never uses it.
  // `ensureRealtimeReady()` runs at the two places that do.

  runApp(const ProviderScope(child: MessOsApp()));
}
