/// The counter screens' data, and the till's mutations.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/staff_models.dart';
import 'auth_controller.dart';

final staffCountsProvider = FutureProvider.autoDispose<StaffCounts>((ref) async {
  return StaffCounts.fromJson(
    await ref.watch(apiClientProvider).get('/api/staff/counts'),
  );
});

final staffSalesProvider = FutureProvider.autoDispose<StaffSales>((ref) async {
  return StaffSales.fromJson(
    await ref.watch(apiClientProvider).get('/api/staff/sales'),
  );
});

/// Every till write goes through the one endpoint, which dispatches to the same
/// Server Actions the web counter uses. Nothing here decides anything — the
/// merge-or-add rule, the double-finalise guard and the payment concurrency
/// check all live on the server.
Future<String?> tillAction(
  WidgetRef ref,
  String action, {
  String? billId,
  Map<String, Object> fields = const {},
}) async {
  final json = await ref.read(apiClientProvider).post(
    '/api/staff/sales',
    body: {
      'action': action,
      'billId': ?billId,
      'fields': fields,
    },
  );
  ref.invalidate(staffSalesProvider);
  return json['billId'] as String?;
}
