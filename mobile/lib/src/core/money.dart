/// Money, in integer paise, formatted for an Indian reader.
///
/// Paise are the only representation that crosses the wire (rule 3: `BIGINT` in
/// Postgres, integer paise in TypeScript, `int` here). Rupees exist solely at
/// the render boundary — this file — and never in a variable, a model field or a
/// request body. A double anywhere in that chain reintroduces exactly the
/// rounding drift the integer rule exists to prevent.
///
/// Grouping is Indian, not Western: `₹1,00,000`, never `₹100,000`. That is a
/// correctness requirement in DESIGN.md, not a nicety — a student reading a
/// Western-grouped figure misreads a lakh as a hundred thousand at a glance, and
/// they are checking what they were charged.
library;

import 'package:intl/intl.dart';

/// `en_IN` puts the separators in the lakh/crore positions for us.
final NumberFormat _rupees = NumberFormat.currency(
  locale: 'en_IN',
  symbol: '₹',
  decimalDigits: 2,
);

final NumberFormat _rupeesWhole = NumberFormat.currency(
  locale: 'en_IN',
  symbol: '₹',
  decimalDigits: 0,
);

/// `450000` → `₹4,500.00`.
String formatPaise(int paise) => _rupees.format(paise / 100);

/// `450000` → `₹4,500`, for dense tables where the paise are always `00`.
///
/// Falls back to the full form the moment there is a non-zero remainder, so a
/// price of ₹4,500.50 can never be displayed as ₹4,500 — silently dropping half
/// a rupee off a number a student is checking is worse than an untidy column.
String formatPaiseCompact(int paise) =>
    paise % 100 == 0 ? _rupeesWhole.format(paise ~/ 100) : formatPaise(paise);

/// A per-meal or per-day rate, floored.
///
/// Floors deliberately, matching the server (`per_day_inr` in the subscriptions
/// export). Rounding up would let the parts sum to more than the student
/// actually paid, which is the one direction a money display must never err in.
int perUnitPaise(int totalPaise, int units) =>
    units <= 0 ? 0 : totalPaise ~/ units;
