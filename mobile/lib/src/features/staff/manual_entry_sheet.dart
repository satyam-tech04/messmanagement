/// The audited manual fallback.
///
/// For a code that will not scan — a cracked screen, a flat battery, a camera
/// that has given up. **Not a bypass**: the server runs the identical
/// eligibility policy, derives the service date from the mess's own clock so
/// nothing can be backdated, and writes an `ATTENDANCE_MANUAL_OVERRIDE` audit
/// row naming who did it and why.
///
/// The reason field is required for that audit row, which is why it is not
/// optional here even though it slows the counter down.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'scanner_screen.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';

const _slots = ['BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER'];

class ManualEntrySheet extends ConsumerStatefulWidget {
  const ManualEntrySheet({super.key, required this.deviceId, this.prefillRoll});

  final String deviceId;

  /// Carried over from a denial that allows the fallback, so staff do not
  /// retype a roll number the scan already read.
  final String? prefillRoll;

  @override
  ConsumerState<ManualEntrySheet> createState() => _ManualEntrySheetState();
}

class _ManualEntrySheetState extends ConsumerState<ManualEntrySheet> {
  late final _roll = TextEditingController(text: widget.prefillRoll ?? '');
  final _reason = TextEditingController();
  String _slot = 'LUNCH';
  bool _busy = false;

  @override
  void dispose() {
    _roll.dispose();
    _reason.dispose();
    super.dispose();
  }

  bool get _valid =>
      _roll.text.trim().isNotEmpty && _reason.text.trim().length >= 3;

  Future<void> _submit() async {
    if (!_valid || _busy) return;
    setState(() => _busy = true);

    final result = await ref
        .read(verifyRepositoryProvider)
        .verifyManual(
          rollNumber: _roll.text,
          mealSlot: _slot,
          reason: _reason.text,
          deviceId: widget.deviceId,
        );

    if (mounted) Navigator.of(context).pop(result);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: EdgeInsets.only(
        left: Space.xl,
        right: Space.xl,
        top: Space.xl,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Serve without a code',
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const Gap.sm(),
          Text(
            'This is recorded against your account, with your reason.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const Gap.xl(),

          TextField(
            controller: _roll,
            autofocus: widget.prefillRoll == null,
            autocorrect: false,
            textCapitalization: TextCapitalization.characters,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: 'Roll number',
              prefixIcon: Icon(Icons.badge_outlined),
            ),
          ),
          const Gap.md(),

          // Fixed list rather than the tenant's configured slots: this sheet
          // must work when the settings call is the thing that failed.
          SegmentedButton<String>(
            segments: [
              for (final slot in _slots)
                ButtonSegment(
                  value: slot,
                  label: Text(
                    '${slot[0]}${slot.substring(1).toLowerCase()}',
                    style: Theme.of(context).textTheme.labelMedium,
                  ),
                ),
            ],
            selected: {_slot},
            onSelectionChanged: (s) => setState(() => _slot = s.first),
          ),
          const Gap.md(),

          TextField(
            controller: _reason,
            onChanged: (_) => setState(() {}),
            maxLength: 500,
            decoration: const InputDecoration(
              labelText: 'Reason',
              helperText: 'At least 3 characters — this goes in the audit log',
              prefixIcon: Icon(Icons.notes_rounded),
            ),
          ),

          FilledButton(
            // Disabled until valid, rather than failing on submit: at a counter
            // a refused submission costs a round trip and the staff member's
            // attention, both of which the queue is paying for.
            onPressed: _valid && !_busy ? _submit : null,
            child: _busy
                ? const SizedBox(
                    height: 22,
                    width: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.5),
                  )
                : const Text('Serve this student'),
          ),
        ],
      ),
    );
  }
}
