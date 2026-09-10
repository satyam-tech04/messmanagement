/// The student screens' data, and the mutations that change it.
///
/// Each read is a `FutureProvider` so every screen gets the four states
/// DESIGN.md requires for free — loading, error with a retry, empty, populated —
/// rather than each one inventing its own.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/student_models.dart';
import 'auth_controller.dart';
import 'connectivity.dart';

final studentMenuProvider = FutureProvider.autoDispose<List<MenuDay>>((
  ref,
) async {
  final json = await ref.watch(apiClientProvider).get('/api/student/menu');
  return ((json['days'] as List?) ?? const [])
      .map((e) => MenuDay.fromJson((e as Map).cast<String, dynamic>()))
      .toList();
});

final studentPlanProvider = FutureProvider.autoDispose<StudentPlan>((
  ref,
) async {
  return StudentPlan.fromJson(
    await ref.watch(apiClientProvider).get('/api/student/plan'),
  );
});

final studentAbsencesProvider = FutureProvider.autoDispose<StudentAbsences>((
  ref,
) async {
  ref.watch(reconnectTickProvider);
  return StudentAbsences.fromJson(
    await ref.watch(apiClientProvider).get('/api/student/absences'),
  );
});

final studentFeedbackProvider = FutureProvider.autoDispose<StudentFeedback>((
  ref,
) async {
  ref.watch(reconnectTickProvider);
  return StudentFeedback.fromJson(
    await ref.watch(apiClientProvider).get('/api/student/feedback'),
  );
});

/// Ask to be marked out of meals.
///
/// Every rule is enforced on the server — the monthly cap, the notice window,
/// that a skip may not cross a month boundary. Failures surface as an
/// `ApiFailure` whose message is written for the student, so callers should show
/// it rather than substituting their own.
Future<void> requestAbsence(
  WidgetRef ref, {
  required String kind,
  required String dateFrom,
  required String dateTo,
  required List<String> mealSlots,
}) async {
  await ref
      .read(apiClientProvider)
      .post(
        '/api/student/absences',
        body: {
          'kind': kind,
          'dateFrom': dateFrom,
          'dateTo': dateTo,
          'mealSlots': mealSlots,
        },
      );
  ref.invalidate(studentAbsencesProvider);
}

Future<void> cancelAbsence(WidgetRef ref, String id) async {
  await ref.read(apiClientProvider).post('/api/student/absences/$id/cancel');
  ref.invalidate(studentAbsencesProvider);
}

Future<void> submitFeedback(
  WidgetRef ref, {
  required String serviceDate,
  required String mealSlot,
  required int rating,
  String? comment,
}) async {
  await ref
      .read(apiClientProvider)
      .post(
        '/api/student/feedback',
        body: {
          'serviceDate': serviceDate,
          'mealSlot': mealSlot,
          'rating': rating,
          if (comment != null && comment.trim().isNotEmpty)
            'comment': comment.trim(),
        },
      );
  ref.invalidate(studentFeedbackProvider);
}
