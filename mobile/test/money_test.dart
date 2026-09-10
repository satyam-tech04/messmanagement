import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mealadda/src/core/money.dart';

/// Money is integer paise everywhere, and rupees only at the render boundary.
///
/// The grouping assertions are the point of this file. Indian digit grouping
/// puts separators at the lakh and crore positions, so ₹1,00,000 is one lakh
/// while ₹100,000 reads to an Indian eye as something else entirely. A student
/// checking what they were charged has to be able to trust the number at a
/// glance, and DESIGN.md makes this a requirement rather than a preference.
void main() {
  setUpAll(() async => initializeDateFormatting('en_IN'));

  group('formatPaise', () {
    test('renders paise as rupees', () {
      expect(formatPaise(450000), '₹4,500.00');
    });

    test('groups in lakhs, not thousands', () {
      // The whole reason this file exists.
      expect(formatPaise(10000000), '₹1,00,000.00');
    });

    test('groups in crores', () {
      expect(formatPaise(1000000000), '₹1,00,00,000.00');
    });

    test('keeps a non-zero paise remainder visible', () {
      expect(formatPaise(450050), '₹4,500.50');
    });

    test('renders zero rather than an empty cell', () {
      expect(formatPaise(0), '₹0.00');
    });

    test('renders a negative amount, for a reversal or a credit', () {
      expect(formatPaise(-450000), contains('4,500.00'));
    });
  });

  group('formatPaiseCompact', () {
    test('drops the decimals when there is nothing to lose', () {
      expect(formatPaiseCompact(450000), '₹4,500');
    });

    test('still groups in lakhs', () {
      expect(formatPaiseCompact(10000000), '₹1,00,000');
    });

    test('falls back to full precision when paise are non-zero', () {
      // Never show ₹4,500 for ₹4,500.50 — silently losing half a rupee off a
      // figure someone is checking is worse than an untidy column.
      expect(formatPaiseCompact(450050), '₹4,500.50');
    });
  });

  group('perUnitPaise', () {
    test('divides a plan price across its meals', () {
      expect(perUnitPaise(300000, 60), 5000);
    });

    test('floors, so the parts can never sum above what was paid', () {
      // 1000 / 3 = 333.33 paise. Rounding up would make three meals cost more
      // than the plan did.
      expect(perUnitPaise(1000, 3), 333);
      expect(perUnitPaise(1000, 3) * 3, lessThanOrEqualTo(1000));
    });

    test('returns zero rather than dividing by zero', () {
      expect(perUnitPaise(300000, 0), 0);
      expect(perUnitPaise(300000, -1), 0);
    });
  });
}
