import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mealadda/src/data/student_models.dart';
import 'package:mealadda/src/design/theme.dart';
import 'package:mealadda/src/features/student/announcements_card.dart';
import 'package:mealadda/src/state/student_providers.dart';

/// Special-meal announcements on the student's own screen (spec §10).
///
/// Before this the app had no way to see them at all: an admin posted "Onam
/// Sadhya on Sunday", web students saw it, and everyone on the phone app
/// found out by walking in. The rules worth pinning down are the ones the spec
/// is explicit about — shown when live, and **absent entirely** when not, so an
/// empty card never takes space from the QR code on the screen held up at the
/// counter.
void main() {
  setUpAll(() async => initializeDateFormatting('en_IN'));

  group('Announcement.fromJson', () {
    test('reads every field the server sends', () {
      final a = Announcement.fromJson({
        'id': 'a-1',
        'title': 'Onam Sadhya',
        'body': 'Payasam, avial, thoran.',
        'serviceDate': '2026-09-14',
        'mealSlot': 'LUNCH',
      });
      expect(a.id, 'a-1');
      expect(a.title, 'Onam Sadhya');
      expect(a.body, 'Payasam, avial, thoran.');
      expect(a.serviceDate, '2026-09-14');
      expect(a.mealSlot, 'LUNCH');
    });

    test('tolerates an announcement about no particular day or meal', () {
      final a = Announcement.fromJson({'id': 'a-2', 'title': 'Mess closed'});
      expect(a.body, isNull);
      expect(a.serviceDate, isNull);
      expect(a.mealSlot, isNull);
    });

    test('treats a blank body as no body', () {
      final a = Announcement.fromJson({
        'id': 'a-3',
        'title': 'Biryani night',
        'body': '   ',
      });
      expect(a.body, isNull);
    });
  });

  Future<void> pump(WidgetTester tester, List<Announcement> items) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          studentAnnouncementsProvider.overrideWith((ref) async => items),
        ],
        child: MaterialApp(
          theme: messLightTheme(),
          home: const Scaffold(body: AnnouncementsCard()),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  group('AnnouncementsCard', () {
    testWidgets('shows the title, the day and meal, and the detail', (
      tester,
    ) async {
      await pump(tester, [
        const Announcement(
          id: 'a-1',
          title: 'Onam Sadhya',
          body: 'Payasam, avial, thoran.',
          serviceDate: '2026-09-14',
          mealSlot: 'LUNCH',
        ),
      ]);
      expect(find.text('Onam Sadhya'), findsOneWidget);
      expect(find.textContaining('Lunch'), findsOneWidget);
      expect(find.textContaining('14'), findsOneWidget);
      expect(find.text('Payasam, avial, thoran.'), findsOneWidget);
    });

    testWidgets('shows every live announcement', (tester) async {
      await pump(tester, [
        const Announcement(id: 'a-1', title: 'Onam Sadhya'),
        const Announcement(id: 'a-2', title: 'Ice cream on Friday'),
      ]);
      expect(find.text('Onam Sadhya'), findsOneWidget);
      expect(find.text('Ice cream on Friday'), findsOneWidget);
    });

    testWidgets('renders nothing at all when none is live', (tester) async {
      await pump(tester, const []);
      expect(find.byType(Card), findsNothing);
      expect(find.byIcon(Icons.campaign_rounded), findsNothing);
    });
  });
}
