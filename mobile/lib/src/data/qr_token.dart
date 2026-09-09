/// The rotating meal code, exactly as `GET /api/qr/token` describes it.
library;

class QrToken {
  const QrToken({
    required this.token,
    required this.mealSlot,
    required this.serviceDate,
    required this.expiresAt,
    required this.refreshSeconds,
    required this.isOpenNow,
    required this.studentName,
    required this.rollNumber,
    this.opensAt,
    this.closesAt,
  });

  /// The signed payload. Rendered as a QR symbol and nothing else — it is
  /// never parsed here, and could not be trusted if it were.
  final String token;

  final String mealSlot;

  /// The **meal's** date, derived in the mess's timezone — not today's date on
  /// this phone. A dinner that runs past midnight still belongs to the day it
  /// started.
  final String serviceDate;

  final DateTime expiresAt;

  /// How long until the next code, from tenant settings. The server guarantees
  /// this is strictly below the token's TTL, so a student is never left holding
  /// a code that died before it was replaced. Always re-arm from this value
  /// rather than a constant — a mess changing its rotation must take effect
  /// without an app release.
  final int refreshSeconds;

  final bool isOpenNow;
  final DateTime? opensAt;
  final DateTime? closesAt;

  final String studentName;
  final String rollNumber;

  static DateTime? _parse(Object? v) =>
      v is String ? DateTime.tryParse(v)?.toLocal() : null;

  factory QrToken.fromJson(Map<String, dynamic> json) => QrToken(
    token: json['token'] as String,
    mealSlot: json['mealSlot'] as String? ?? '',
    serviceDate: json['serviceDate'] as String? ?? '',
    expiresAt: _parse(json['expiresAt']) ?? DateTime.now(),
    // Never default to 0: a zero here becomes a tight polling loop against an
    // endpoint that costs several database round trips per call.
    refreshSeconds: (json['refreshSeconds'] as num?)?.toInt() ?? 15,
    isOpenNow: json['isOpenNow'] as bool? ?? false,
    opensAt: _parse(json['opensAt']),
    closesAt: _parse(json['closesAt']),
    studentName: json['studentName'] as String? ?? '',
    rollNumber: json['rollNumber'] as String? ?? '',
  );
}
