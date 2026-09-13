import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mealadda/src/design/theme.dart';
import 'package:mealadda/src/features/staff/finalise_dialog.dart';

/// Finalising a counter bill asks whether it was paid (D-29).
///
/// Before this the app finalised on a single tap, always as Unpaid, and staff
/// had no way at all to mark it paid — only the admin's web screen could. At a
/// cash counter the money nearly always changes hands as the bill is closed, so
/// Paid is the default; Unpaid is one deliberate tap away.
void main() {
  setUpAll(() async => initializeDateFormatting('en_IN'));

  Future<List<String?>> pumpAndOpen(WidgetTester tester) async {
    final results = <String?>[];
    await tester.pumpWidget(
      MaterialApp(
        theme: messLightTheme(),
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () async => results.add(
                await showFinaliseDialog(
                  context,
                  billNumber: 'BILL-000042',
                  personName: 'Ravi',
                  totalPaise: 12000,
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    return results;
  }

  testWidgets('names the bill and shows its total', (tester) async {
    await pumpAndOpen(tester);
    expect(find.textContaining('BILL-000042'), findsWidgets);
    expect(find.textContaining('120'), findsWidgets);
  });

  testWidgets('defaults to paid', (tester) async {
    final results = await pumpAndOpen(tester);
    await tester.tap(find.text('Finalise as paid'));
    await tester.pumpAndSettle();
    expect(results, ['PAID']);
  });

  testWidgets('finalises as unpaid when staff choose it', (tester) async {
    final results = await pumpAndOpen(tester);
    await tester.tap(find.text('Unpaid'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Finalise as unpaid'));
    await tester.pumpAndSettle();
    expect(results, ['UNPAID']);
  });

  testWidgets('finalises nothing when staff keep editing', (tester) async {
    final results = await pumpAndOpen(tester);
    await tester.tap(find.text('Keep editing'));
    await tester.pumpAndSettle();
    expect(results, [null]);
  });
}
