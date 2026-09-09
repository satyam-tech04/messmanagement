/// Marking yourself out of meals, so the kitchen does not cook for you.
///
/// The form is built from the rules the server sent: the earliest date that may
/// be chosen, how many skip days are left this month, which slots the plan
/// covers. The server enforces every one of them regardless — showing them here
/// is so a student planning a trip home sees the earliest date they may pick,
/// rather than discovering it by being refused.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_failure.dart';
import '../../data/student_models.dart';
import '../../design/async_view.dart';
import '../../design/status_badge.dart';
import '../../state/student_providers.dart';
import 'date_label.dart';

class AbsencesScreen extends ConsumerWidget {
  const AbsencesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final absences = ref.watch(studentAbsencesProvider);

    return absences.when(
      loading: () => ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          Skeleton(height: 120, radius: 16),
          SizedBox(height: 20),
          Skeleton(height: 64, radius: 12),
          SizedBox(height: 8),
          Skeleton(height: 64, radius: 12),
        ],
      ),
      error: (e, _) => ErrorState(
        failure: e,
        onRetry: () => ref.invalidate(studentAbsencesProvider),
      ),
      data: (data) {
        // Both toggles ship off, and a mess that has not enabled either should
        // be told so plainly rather than shown an empty list that reads as
        // "nothing here".
        if (!data.enabled) {
          return const EmptyState(
            icon: Icons.event_busy_rounded,
            title: 'Not available here',
            message:
                'Your mess does not currently let students mark themselves out of '
                'meals. Speak to the mess office if you will be away.',
          );
        }

        if (!data.hasActivePlan) {
          return const EmptyState(
            icon: Icons.card_membership_rounded,
            title: 'No running plan',
            message:
                'You need a running meal plan before you can mark yourself out of '
                'anything. Speak to the mess office.',
          );
        }

        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(studentAbsencesProvider),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            children: [
              _AllowanceCard(data: data),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () => _openForm(context, ref, data),
                icon: const Icon(Icons.add_rounded),
                label: const Text('Mark myself out'),
              ),
              const SizedBox(height: 24),
              Text(
                'Your requests',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 10),
              if (data.history.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: EmptyState(
                    icon: Icons.event_available_rounded,
                    title: 'Nothing yet',
                    message:
                        'When you mark yourself out of a meal it will appear here.',
                  ),
                )
              else
                for (final row in data.history)
                  _AbsenceTile(row: row, onCancel: () => _cancel(context, ref, row)),
            ],
          ),
        );
      },
    );
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref, AbsenceRow row) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await cancelAbsence(ref, row.id);
      messenger.showSnackBar(const SnackBar(content: Text('Request withdrawn.')));
    } on ApiFailure catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _openForm(
    BuildContext context,
    WidgetRef ref,
    StudentAbsences data,
  ) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _AbsenceForm(data: data),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            data.awayRequiresApproval
                ? 'Sent. The mess office will confirm it.'
                : 'Done — the kitchen will not cook for you.',
          ),
        ),
      );
    }
  }
}

class _AllowanceCard extends StatelessWidget {
  const _AllowanceCard({required this.data});

  final StudentAbsences data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'This month',
              style: theme.textTheme.labelMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              data.allowMealSkipping
                  ? '${data.skipDaysLeft} of ${data.cutMaxDaysPerMonth} skip days left'
                  : 'Skipping single meals is off',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            if (data.earliestSkipDate != null) ...[
              const SizedBox(height: 8),
              Text(
                // The notice window, said as a date rather than as hours:
                // "choose 12 September" is actionable, "wait 20 more hours"
                // is not.
                'Earliest you can choose: ${formatServiceDate(data.earliestSkipDate!)}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _AbsenceTile extends StatelessWidget {
  const _AbsenceTile({required this.row, required this.onCancel});

  final AbsenceRow row;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    formatServiceDateRange(row.dateFrom, row.dateTo),
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    row.mealSlots
                        .map((s) => '${s[0]}${s.substring(1).toLowerCase()}')
                        .join(', '),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (row.rejectionReason != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      row.rejectionReason!,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.error,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                StatusBadge.forStatus(row.status),
                if (row.canCancel)
                  TextButton(
                    onPressed: onCancel,
                    child: const Text('Withdraw'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _AbsenceForm extends ConsumerStatefulWidget {
  const _AbsenceForm({required this.data});

  final StudentAbsences data;

  @override
  ConsumerState<_AbsenceForm> createState() => _AbsenceFormState();
}

class _AbsenceFormState extends ConsumerState<_AbsenceForm> {
  late String _kind = widget.data.allowMealSkipping ? 'SKIP' : 'AWAY';
  DateTime? _from;
  DateTime? _to;
  late final Set<String> _slots = {...widget.data.plannedSlots};
  bool _busy = false;
  String? _error;

  StudentAbsences get _d => widget.data;

  /// The notice window, as a date. Parsed in UTC so a plain calendar date does
  /// not shift by a day on a phone in another zone.
  DateTime get _earliest {
    final raw = _kind == 'SKIP' ? _d.earliestSkipDate : _d.earliestAwayDate;
    return DateTime.tryParse('${raw}T00:00:00Z')?.toUtc() ??
        DateTime.now().toUtc().add(const Duration(days: 1));
  }

  DateTime get _latest {
    final end = DateTime.tryParse('${_d.planEndDate}T00:00:00Z')?.toUtc();
    return end ?? _earliest.add(const Duration(days: 90));
  }

  String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';

  Future<void> _pickRange() async {
    final picked = await showDateRangePicker(
      context: context,
      // The picker itself refuses anything outside the notice window and the
      // plan, so an invalid choice is not merely rejected after a round trip.
      firstDate: _earliest,
      lastDate: _latest,
      currentDate: _earliest,
    );
    if (picked == null) return;
    setState(() {
      _from = picked.start;
      _to = _kind == 'SKIP' ? picked.start : picked.end;
      _error = null;
    });
  }

  Future<void> _submit() async {
    if (_from == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await requestAbsence(
        ref,
        kind: _kind,
        dateFrom: _iso(_from!),
        dateTo: _iso(_to ?? _from!),
        // AWAY covers everything the mess serves; the server expands it anyway.
        mealSlots: _kind == 'AWAY' ? _d.plannedSlots : _slots.toList(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiFailure catch (e) {
      // The server's message names the actual rule — the cap, the notice
      // window, the month boundary. Substituting our own would lose that.
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final canSkip = _d.allowMealSkipping;
    final canAway = _d.allowAwayRequests;

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Mark yourself out',
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 16),

            if (canSkip && canAway)
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'SKIP', label: Text('Skip a meal')),
                  ButtonSegment(value: 'AWAY', label: Text('Away')),
                ],
                selected: {_kind},
                onSelectionChanged: (s) => setState(() {
                  _kind = s.first;
                  _from = null;
                  _to = null;
                  _error = null;
                }),
              ),
            const SizedBox(height: 16),

            OutlinedButton.icon(
              onPressed: _pickRange,
              icon: const Icon(Icons.calendar_month_rounded),
              label: Text(
                _from == null
                    ? 'Choose dates'
                    : formatServiceDateRange(_iso(_from!), _iso(_to ?? _from!)),
              ),
            ),

            if (_kind == 'SKIP') ...[
              const SizedBox(height: 16),
              Text(
                'Which meals',
                style: theme.textTheme.labelLarge,
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                children: [
                  for (final slot in _d.plannedSlots)
                    FilterChip(
                      label: Text('${slot[0]}${slot.substring(1).toLowerCase()}'),
                      selected: _slots.contains(slot),
                      // A mess that does not allow partial days needs every
                      // served slot, so the chips stop being a choice.
                      onSelected: _d.allowPartialDaySkip
                          ? (on) => setState(() {
                              on ? _slots.add(slot) : _slots.remove(slot);
                            })
                          : null,
                    ),
                ],
              ),
              if (!_d.allowPartialDaySkip)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    'Your mess only allows skipping a whole day.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
            ],

            if (_error != null) ...[
              const SizedBox(height: 16),
              Semantics(
                liveRegion: true,
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    _error!,
                    style: TextStyle(color: theme.colorScheme.onErrorContainer),
                  ),
                ),
              ),
            ],

            const SizedBox(height: 20),
            FilledButton(
              onPressed: _from == null || _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(
                      height: 22,
                      width: 22,
                      child: CircularProgressIndicator(strokeWidth: 2.5),
                    )
                  : const Text('Confirm'),
            ),
          ],
        ),
      ),
    );
  }
}
