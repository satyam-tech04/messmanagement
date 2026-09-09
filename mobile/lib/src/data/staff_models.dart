/// What the counter endpoints return.
library;

class SlotCount {
  const SlotCount({
    required this.mealSlot,
    required this.label,
    required this.projected,
    required this.served,
    required this.locked,
  });

  final String mealSlot;
  final String label;

  /// How many the kitchen should cook for.
  final int projected;
  final int served;

  /// Once locked, the projection is the number the kitchen already bought for
  /// and stops moving — even as subscriptions change underneath.
  final bool locked;

  int get remaining => (projected - served).clamp(0, projected);

  factory SlotCount.fromJson(Map<String, dynamic> j) => SlotCount(
    mealSlot: j['mealSlot'] as String? ?? '',
    label: j['label'] as String? ?? '',
    projected: (j['projected'] as num?)?.toInt() ?? 0,
    served: (j['served'] as num?)?.toInt() ?? 0,
    locked: j['locked'] as bool? ?? false,
  );
}

class StaffCounts {
  const StaffCounts({required this.serviceDate, required this.slots});

  /// The mess's own day. The realtime filter matches on this, so it has to come
  /// from the server rather than being re-derived from the device clock.
  final String serviceDate;
  final List<SlotCount> slots;

  factory StaffCounts.fromJson(Map<String, dynamic> j) => StaffCounts(
    serviceDate: j['serviceDate'] as String? ?? '',
    slots: ((j['slots'] as List?) ?? const [])
        .map((e) => SlotCount.fromJson((e as Map).cast<String, dynamic>()))
        .toList(),
  );
}

class BillLine {
  const BillLine({
    required this.id,
    required this.counterItemId,
    required this.itemName,
    required this.unit,
    required this.unitPricePaise,
    required this.quantity,
  });

  final String id;
  final String counterItemId;

  /// The snapshot taken when the line was added. A later price change must
  /// never rewrite a bill somebody has already been quoted.
  final String itemName;
  final String? unit;
  final int unitPricePaise;
  final int quantity;

  int get linePaise => unitPricePaise * quantity;

  factory BillLine.fromJson(Map<String, dynamic> j) => BillLine(
    id: j['id'] as String? ?? '',
    counterItemId: j['counterItemId'] as String? ?? '',
    itemName: j['itemName'] as String? ?? '',
    unit: j['unit'] as String?,
    unitPricePaise: (j['unitPricePaise'] as num?)?.toInt() ?? 0,
    quantity: (j['quantity'] as num?)?.toInt() ?? 0,
  );
}

class OpenBill {
  const OpenBill({
    required this.id,
    required this.billNumber,
    required this.personName,
    required this.lines,
    required this.totalPaise,
  });

  final String id;
  final String billNumber;
  final String personName;
  final List<BillLine> lines;

  /// Summed from the lines, never accumulated.
  final int totalPaise;

  factory OpenBill.fromJson(Map<String, dynamic> j) => OpenBill(
    id: j['id'] as String? ?? '',
    billNumber: j['billNumber'] as String? ?? '',
    personName: j['personName'] as String? ?? '',
    lines: ((j['lines'] as List?) ?? const [])
        .map((e) => BillLine.fromJson((e as Map).cast<String, dynamic>()))
        .toList(),
    totalPaise: (j['totalPaise'] as num?)?.toInt() ?? 0,
  );
}

class CatalogueItem {
  const CatalogueItem({
    required this.id,
    required this.itemCode,
    required this.itemName,
    required this.unit,
    required this.pricePaise,
  });

  final String id;
  final String itemCode;
  final String itemName;
  final String? unit;
  final int pricePaise;

  factory CatalogueItem.fromJson(Map<String, dynamic> j) => CatalogueItem(
    id: j['id'] as String? ?? '',
    itemCode: j['itemCode'] as String? ?? '',
    itemName: j['itemName'] as String? ?? '',
    unit: j['unit'] as String?,
    pricePaise: (j['pricePaise'] as num?)?.toInt() ?? 0,
  );
}

class StaffSales {
  const StaffSales({
    required this.openBills,
    required this.catalogue,
    required this.takingsTodayPaise,
    required this.billsToday,
  });

  /// A shared pool, not per-staff: whoever is free finalises whatever is in
  /// front of them, which is how a counter works during a rush.
  final List<OpenBill> openBills;
  final List<CatalogueItem> catalogue;
  final int takingsTodayPaise;
  final int billsToday;

  factory StaffSales.fromJson(Map<String, dynamic> j) => StaffSales(
    openBills: ((j['openBills'] as List?) ?? const [])
        .map((e) => OpenBill.fromJson((e as Map).cast<String, dynamic>()))
        .toList(),
    catalogue: ((j['catalogue'] as List?) ?? const [])
        .map((e) => CatalogueItem.fromJson((e as Map).cast<String, dynamic>()))
        .toList(),
    takingsTodayPaise: (j['takingsTodayPaise'] as num?)?.toInt() ?? 0,
    billsToday: (j['billsToday'] as num?)?.toInt() ?? 0,
  );
}
