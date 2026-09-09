/// Rendering a service date the server already resolved.
///
/// A service date is a **plain calendar date**, not an instant. Parsing it as
/// local time and formatting it back is how "9 September" becomes "8 September"
/// for a student whose phone is a few hours behind the mess — so it is parsed
/// and read back in UTC, which shifts nothing.
///
/// The same rule the web app follows for exactly the same reason.
library;

import 'package:intl/intl.dart';

final _dayMonth = DateFormat('d MMMM', 'en_IN');
final _dayMonthShort = DateFormat('d MMM', 'en_IN');

/// `2026-09-09` → `9 September`.
String formatServiceDate(String serviceDate) {
  final parsed = DateTime.tryParse('${serviceDate}T00:00:00Z');
  if (parsed == null) return serviceDate;
  return _dayMonth.format(parsed.toUtc());
}

/// `2026-09-09` → `9 Sep`, for dense rows.
String formatServiceDateShort(String serviceDate) {
  final parsed = DateTime.tryParse('${serviceDate}T00:00:00Z');
  if (parsed == null) return serviceDate;
  return _dayMonthShort.format(parsed.toUtc());
}

/// `9 Sep` for a single day, `9 Sep – 12 Sep` for a range.
String formatServiceDateRange(String from, String to) => from == to
    ? formatServiceDateShort(from)
    : '${formatServiceDateShort(from)} – ${formatServiceDateShort(to)}';
