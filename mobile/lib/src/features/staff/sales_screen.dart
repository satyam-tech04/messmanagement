/// The counter till.
///
/// Open bills are a **shared pool**, not one per staff member: whoever is free
/// finalises whatever is in front of them, which is how a counter actually works
/// during a rush.
///
/// Nothing here decides anything. Merge-or-add a line, the double-finalise
/// guard, the payment concurrency check and every audit row live in the Server
/// Actions the web counter already uses — this screen only asks.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_failure.dart';
import '../../core/money.dart';
import '../../data/staff_models.dart';
import '../../design/async_view.dart';
import '../../design/theme.dart';
import '../../state/staff_providers.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';

class SalesScreen extends ConsumerWidget {
  const SalesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sales = ref.watch(staffSalesProvider);

    return sales.when(
      loading: () => ListView(
        padding: const EdgeInsets.all(Space.lg),
        children: const [
          Skeleton(height: 72, radius: Radii.md),
          Gap.lg(),
          Skeleton(height: 120, radius: Radii.md),
          Gap.sm(),
          Skeleton(height: 120, radius: Radii.md),
        ],
      ),
      error: (e, _) => ErrorState(
        failure: e,
        onRetry: () => ref.invalidate(staffSalesProvider),
      ),
      data: (data) => Scaffold(
        body: RefreshIndicator(
          onRefresh: () async => ref.invalidate(staffSalesProvider),
          child: ListView(
            padding: Insets.listWithFab,
            children: [
              _TakingsCard(data: data),
              const Gap.lg(),
              if (data.openBills.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: Space.xxxl),
                  child: EmptyState(
                    icon: Icons.receipt_long_rounded,
                    title: 'No open bills',
                    message:
                        'Start one when somebody orders something from the counter.',
                  ),
                )
              else
                for (final bill in data.openBills)
                  _BillCard(bill: bill, catalogue: data.catalogue),
            ],
          ),
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => _startBill(context, ref),
          icon: const Icon(Icons.add_rounded),
          label: const Text('New bill'),
        ),
      ),
    );
  }

  Future<void> _startBill(BuildContext context, WidgetRef ref) async {
    final name = await showDialog<String>(
      context: context,
      builder: (_) => const _NameDialog(title: 'Who is this for?'),
    );
    if (name == null || !context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await tillAction(ref, 'createBill', fields: {'personName': name});
    } on ApiFailure catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }
}

class _TakingsCard extends StatelessWidget {
  const _TakingsCard({required this.data});

  final StaffSales data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(Space.lg),
        child: Row(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Taken today',
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                Text(
                  formatPaiseCompact(data.takingsTodayPaise),
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
            const Spacer(),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  '${data.billsToday} bills',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                Text(
                  '${data.openBills.length} open',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _BillCard extends ConsumerWidget {
  const _BillCard({required this.bill, required this.catalogue});

  final OpenBill bill;
  final List<CatalogueItem> catalogue;

  Future<void> _run(
    BuildContext context,
    WidgetRef ref,
    String action, {
    Map<String, Object> fields = const {},
  }) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await tillAction(ref, action, billId: bill.id, fields: fields);
    } on ApiFailure catch (e) {
      // The server's wording is the useful one — "Somebody else just changed
      // this. Reload the page." names the actual situation.
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.only(bottom: Space.sm),
      child: Padding(
        padding: const EdgeInsets.all(Space.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        bill.personName,
                        style: context.texts.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        bill.billNumber,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  formatPaiseCompact(bill.totalPaise),
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
            const Divider(height: 20),

            if (bill.lines.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: Space.sm),
                child: Text(
                  'Nothing on this bill yet.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              )
            else
              for (final line in bill.lines)
                _LineRow(
                  line: line,
                  onQuantity: (q) => q <= 0
                      ? _run(
                          context,
                          ref,
                          'removeBillLine',
                          fields: {'lineId': line.id},
                        )
                      : _run(
                          context,
                          ref,
                          'setLineQuantity',
                          fields: {'lineId': line.id, 'quantity': q},
                        ),
                ),

            const Gap.sm(),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                TextButton.icon(
                  onPressed: () => _addItem(context, ref),
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('Add item'),
                ),
                TextButton(
                  onPressed: () => _confirmCancel(context, ref),
                  child: Text(
                    'Cancel bill',
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                ),
                FilledButton(
                  // A bill with no lines cannot be finalised; the server refuses
                  // it too, but disabling here saves a round trip at a counter.
                  onPressed: bill.lines.isEmpty
                      ? null
                      : () => _run(context, ref, 'finalizeBill'),
                  child: const Text('Finalise'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _addItem(BuildContext context, WidgetRef ref) async {
    final item = await showModalBottomSheet<CatalogueItem>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _CataloguePicker(catalogue: catalogue),
    );
    if (item == null || !context.mounted) return;
    await _run(
      context,
      ref,
      'addBillLine',
      fields: {'billId': bill.id, 'itemId': item.id, 'quantity': 1},
    );
  }

  Future<void> _confirmCancel(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Cancel this bill?'),
        // Names the specific record, as DESIGN.md requires of anything
        // destructive.
        content: Text(
          '${bill.billNumber} for ${bill.personName} will be cancelled. '
          'It stays on record but nothing is charged.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Keep it'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Cancel bill'),
          ),
        ],
      ),
    );
    if (ok == true && context.mounted) await _run(context, ref, 'cancelBill');
  }
}

class _LineRow extends StatelessWidget {
  const _LineRow({required this.line, required this.onQuantity});

  final BillLine line;
  final void Function(int quantity) onQuantity;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: Space.xs),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(line.itemName),
                Text(
                  '${formatPaiseCompact(line.unitPricePaise)}'
                  '${line.unit == null ? '' : ' / ${line.unit}'}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: () => onQuantity(line.quantity - 1),
            icon: const Icon(Icons.remove_circle_outline_rounded),
            tooltip: line.quantity <= 1 ? 'Remove' : 'One fewer',
          ),
          SizedBox(
            width: 28,
            child: Text(
              '${line.quantity}',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontWeight: FontWeight.w700,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ),
          IconButton(
            onPressed: () => onQuantity(line.quantity + 1),
            icon: const Icon(Icons.add_circle_outline_rounded),
            tooltip: 'One more',
          ),
          SizedBox(
            width: 72,
            child: Text(
              formatPaiseCompact(line.linePaise),
              textAlign: TextAlign.right,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CataloguePicker extends StatelessWidget {
  const _CataloguePicker({required this.catalogue});

  final List<CatalogueItem> catalogue;

  @override
  Widget build(BuildContext context) {
    if (catalogue.isEmpty) {
      return const SizedBox(
        height: 280,
        child: EmptyState(
          icon: Icons.inventory_2_outlined,
          title: 'Nothing to sell yet',
          message: 'An admin adds counter items on the web console.',
        ),
      );
    }

    return SafeArea(
      child: ListView.builder(
        shrinkWrap: true,
        itemCount: catalogue.length,
        itemBuilder: (context, i) {
          final item = catalogue[i];
          return ListTile(
            title: Text(item.itemName),
            subtitle: Text(item.unit ?? item.itemCode),
            trailing: Text(
              formatPaiseCompact(item.pricePaise),
              style: const TextStyle(
                fontWeight: FontWeight.w700,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
            onTap: () => Navigator.pop(context, item),
          );
        },
      ),
    );
  }
}

class _NameDialog extends StatefulWidget {
  const _NameDialog({required this.title});

  final String title;

  @override
  State<_NameDialog> createState() => _NameDialogState();
}

class _NameDialogState extends State<_NameDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: TextField(
      controller: _controller,
      autofocus: true,
      textCapitalization: TextCapitalization.words,
      maxLength: 120,
      decoration: const InputDecoration(labelText: 'Name'),
      onChanged: (_) => setState(() {}),
      onSubmitted: (v) =>
          v.trim().isEmpty ? null : Navigator.pop(context, v.trim()),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: _controller.text.trim().isEmpty
            ? null
            : () => Navigator.pop(context, _controller.text.trim()),
        child: const Text('Start'),
      ),
    ],
  );
}
