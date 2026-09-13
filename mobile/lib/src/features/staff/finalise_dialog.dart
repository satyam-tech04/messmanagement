/// Confirms a counter bill before it is finalised, and records whether it was
/// paid (D-29).
///
/// Finalising cannot be undone, so it is confirmed like any other irreversible
/// action. Paid is the default: at a cash counter the money nearly always
/// changes hands as the bill is closed. Nothing is decided here — the server
/// validates the choice and applies it in the same write as the finalise.
library;

import 'package:flutter/material.dart';

import '../../core/money.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';

/// Returns `'PAID'` or `'UNPAID'`, or `null` when staff keep editing.
Future<String?> showFinaliseDialog(
  BuildContext context, {
  required String billNumber,
  required String personName,
  required int totalPaise,
}) {
  return showDialog<String>(
    context: context,
    builder: (_) => _FinaliseDialog(
      billNumber: billNumber,
      personName: personName,
      totalPaise: totalPaise,
    ),
  );
}

class _FinaliseDialog extends StatefulWidget {
  const _FinaliseDialog({
    required this.billNumber,
    required this.personName,
    required this.totalPaise,
  });

  final String billNumber;
  final String personName;
  final int totalPaise;

  @override
  State<_FinaliseDialog> createState() => _FinaliseDialogState();
}

class _FinaliseDialogState extends State<_FinaliseDialog> {
  String _payment = 'PAID';

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final paid = _payment == 'PAID';

    return AlertDialog(
      title: Text('Finalise ${widget.billNumber}?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${widget.personName} · once finalised, the bill can no longer be edited.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: Space.lg),
          Row(
            children: [
              Expanded(child: Text('Total', style: theme.textTheme.bodyMedium)),
              Text(
                formatPaise(widget.totalPaise),
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          const SizedBox(height: Space.lg),
          Text('Payment', style: context.texts.labelLarge),
          const SizedBox(height: Space.sm),
          SizedBox(
            width: double.infinity,
            child: SegmentedButton<String>(
              segments: const [
                ButtonSegment(
                  value: 'PAID',
                  label: Text('Paid'),
                  icon: Icon(Icons.check_circle_outline_rounded),
                ),
                ButtonSegment(
                  value: 'UNPAID',
                  label: Text('Unpaid'),
                  icon: Icon(Icons.schedule_rounded),
                ),
              ],
              selected: {_payment},
              onSelectionChanged: (s) => setState(() => _payment = s.first),
            ),
          ),
          const SizedBox(height: Space.xs),
          Text(
            paid ? 'Money received now.' : 'To be collected later.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Keep editing'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, _payment),
          child: Text(paid ? 'Finalise as paid' : 'Finalise as unpaid'),
        ),
      ],
    );
  }
}
