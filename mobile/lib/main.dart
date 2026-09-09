import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'src/app.dart';
import 'src/core/config.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  AppConfig.assertConfigured();

  // Loaded before the first frame so no screen ever renders a date or an amount
  // in the wrong locale while the data arrives. `en_IN` is what puts the
  // separators in the lakh and crore positions.
  await initializeDateFormatting('en_IN');

  runApp(const ProviderScope(child: MessOsApp()));
}
