/// What the student endpoints return.
///
/// Every date here stays the **string the server sent**. It is already the
/// mess's own day, derived in the mess's timezone, and re-parsing it into a
/// local `DateTime` is how a student on a phone set to another zone gets told
/// their plan ended a day early (rule 9).
library;

class MenuSlot {
  const MenuSlot({
    required this.mealSlot,
    required this.label,
    required this.window,
    required this.items,
    required this.notes,
    required this.servingNow,
  });

  final String mealSlot;
  final String label;

  /// Wall-clock window in the mess's timezone, e.g. "12:30–14:00".
  final String? window;
  final List<String> items;
  final String? notes;
  final bool servingNow;

  factory MenuSlot.fromJson(Map<String, dynamic> j) => MenuSlot(
    mealSlot: j['mealSlot'] as String? ?? '',
    label: j['label'] as String? ?? '',
    window: j['window'] as String?,
    items: ((j['items'] as List?) ?? const []).map((e) => '$e').toList(),
    notes: j['notes'] as String?,
    servingNow: j['servingNow'] as bool? ?? false,
  );
}

class MenuDay {
  const MenuDay({
    required this.serviceDate,
    required this.isToday,
    required this.slots,
  });

  final String serviceDate;
  final bool isToday;
  final List<MenuSlot> slots;

  factory MenuDay.fromJson(Map<String, dynamic> j) => MenuDay(
    serviceDate: j['serviceDate'] as String? ?? '',
    isToday: j['isToday'] as bool? ?? false,
    slots: ((j['slots'] as List?) ?? const [])
        .map((e) => MenuSlot.fromJson((e as Map).cast<String, dynamic>()))
        .toList(),
  );
}

class StudentSubscription {
  const StudentSubscription({
    required this.id,
    required this.planName,
    required this.startDate,
    required this.endDate,
    required this.pricePaise,
    required this.includedMealSlots,
    required this.state,
    required this.durationDays,
  });

  final String id;
  final String? planName;
  final String startDate;
  final String endDate;

  /// Integer paise. Formatted only at the render boundary (rule 3).
  final int pricePaise;
  final List<String> includedMealSlots;

  /// Derived from the dates by the server, never the stored status column.
  final String state;
  final int? durationDays;

  /// A plan inside its last week.
  ///
  /// Presentation only, and deliberately so: the server decides whether a plan
  /// is RUNNING, and this only decides whether to say so in orange. A student
  /// who sees "ending soon" a week out can renew before the day they are turned
  /// away at the counter, which is the entire point of surfacing it.
  static const int endingSoonDays = 7;

  int? get daysRemaining {
    // Parsed as UTC, like every service date: these are plain calendar dates
    // the mess already resolved, and reading them locally shifts them a day for
    // anyone whose phone is in another zone.
    final end = DateTime.tryParse('${endDate}T00:00:00Z');
    if (end == null) return null;
    final today = DateTime.now().toUtc();
    return end
        .difference(DateTime.utc(today.year, today.month, today.day))
        .inDays;
  }

  bool get isEndingSoon {
    if (state != 'RUNNING') return false;
    final left = daysRemaining;
    return left != null && left >= 0 && left <= endingSoonDays;
  }

  /// What the badge should say — the server's state, or the warning that
  /// precedes it.
  String get displayState => isEndingSoon ? 'ENDING_SOON' : state;

  factory StudentSubscription.fromJson(Map<String, dynamic> j) =>
      StudentSubscription(
        id: j['id'] as String? ?? '',
        planName: j['planName'] as String?,
        startDate: j['startDate'] as String? ?? '',
        endDate: j['endDate'] as String? ?? '',
        pricePaise: (j['pricePaise'] as num?)?.toInt() ?? 0,
        includedMealSlots: ((j['includedMealSlots'] as List?) ?? const [])
            .map((e) => '$e')
            .toList(),
        state: j['state'] as String? ?? 'EXPIRED',
        durationDays: (j['durationDays'] as num?)?.toInt(),
      );
}

class StudentPlan {
  const StudentPlan({required this.current, required this.history});

  final StudentSubscription? current;
  final List<StudentSubscription> history;

  factory StudentPlan.fromJson(Map<String, dynamic> j) => StudentPlan(
    current: j['current'] == null
        ? null
        : StudentSubscription.fromJson(
            (j['current'] as Map).cast<String, dynamic>(),
          ),
    history: ((j['history'] as List?) ?? const [])
        .map(
          (e) =>
              StudentSubscription.fromJson((e as Map).cast<String, dynamic>()),
        )
        .toList(),
  );
}

class AbsenceRow {
  const AbsenceRow({
    required this.id,
    required this.dateFrom,
    required this.dateTo,
    required this.mealSlots,
    required this.status,
    required this.canCancel,
    this.rejectionReason,
  });

  final String id;
  final String dateFrom;
  final String dateTo;
  final List<String> mealSlots;
  final String status;
  final bool canCancel;
  final String? rejectionReason;

  factory AbsenceRow.fromJson(Map<String, dynamic> j) => AbsenceRow(
    id: j['id'] as String? ?? '',
    dateFrom: j['dateFrom'] as String? ?? '',
    dateTo: j['dateTo'] as String? ?? '',
    mealSlots: ((j['mealSlots'] as List?) ?? const [])
        .map((e) => '$e')
        .toList(),
    status: j['status'] as String? ?? '',
    canCancel: j['canCancel'] as bool? ?? false,
    rejectionReason: j['rejectionReason'] as String?,
  );
}

/// The history **and** the rules the form must obey.
///
/// The rules travel with the data so the picker can refuse a date before a round
/// trip does. The server enforces them regardless — this is courtesy, not
/// security.
class StudentAbsences {
  const StudentAbsences({
    required this.enabled,
    required this.hasActivePlan,
    required this.allowMealSkipping,
    required this.allowPartialDaySkip,
    required this.allowAwayRequests,
    required this.awayRequiresApproval,
    required this.cutMaxDaysPerMonth,
    required this.daysUsedThisMonth,
    required this.awayMaxDays,
    required this.plannedSlots,
    required this.earliestSkipDate,
    required this.earliestAwayDate,
    required this.planEndDate,
    required this.history,
  });

  final bool enabled;
  final bool hasActivePlan;
  final bool allowMealSkipping;
  final bool allowPartialDaySkip;
  final bool allowAwayRequests;
  final bool awayRequiresApproval;
  final int cutMaxDaysPerMonth;
  final int daysUsedThisMonth;
  final int awayMaxDays;
  final List<String> plannedSlots;
  final String? earliestSkipDate;
  final String? earliestAwayDate;
  final String? planEndDate;
  final List<AbsenceRow> history;

  int get skipDaysLeft =>
      (cutMaxDaysPerMonth - daysUsedThisMonth).clamp(0, cutMaxDaysPerMonth);

  factory StudentAbsences.fromJson(Map<String, dynamic> j) => StudentAbsences(
    enabled: j['enabled'] as bool? ?? false,
    hasActivePlan: j['hasActivePlan'] as bool? ?? false,
    allowMealSkipping: j['allowMealSkipping'] as bool? ?? false,
    allowPartialDaySkip: j['allowPartialDaySkip'] as bool? ?? false,
    allowAwayRequests: j['allowAwayRequests'] as bool? ?? false,
    awayRequiresApproval: j['awayRequiresApproval'] as bool? ?? false,
    cutMaxDaysPerMonth: (j['cutMaxDaysPerMonth'] as num?)?.toInt() ?? 0,
    daysUsedThisMonth: (j['daysUsedThisMonth'] as num?)?.toInt() ?? 0,
    awayMaxDays: (j['awayMaxDays'] as num?)?.toInt() ?? 0,
    plannedSlots: ((j['plannedSlots'] as List?) ?? const [])
        .map((e) => '$e')
        .toList(),
    earliestSkipDate: j['earliestSkipDate'] as String?,
    earliestAwayDate: j['earliestAwayDate'] as String?,
    planEndDate: j['planEndDate'] as String?,
    history: ((j['history'] as List?) ?? const [])
        .map((e) => AbsenceRow.fromJson((e as Map).cast<String, dynamic>()))
        .toList(),
  );
}

class FeedbackTarget {
  const FeedbackTarget({
    required this.serviceDate,
    required this.mealSlot,
    required this.label,
    required this.existingRating,
    required this.existingComment,
  });

  final String serviceDate;
  final String mealSlot;
  final String label;
  final int? existingRating;
  final String? existingComment;

  factory FeedbackTarget.fromJson(Map<String, dynamic> j) => FeedbackTarget(
    serviceDate: j['serviceDate'] as String? ?? '',
    mealSlot: j['mealSlot'] as String? ?? '',
    label: j['label'] as String? ?? '',
    existingRating: (j['existingRating'] as num?)?.toInt(),
    existingComment: j['existingComment'] as String?,
  );
}

class StudentFeedback {
  const StudentFeedback({required this.enabled, required this.targets});

  final bool enabled;
  final List<FeedbackTarget> targets;

  factory StudentFeedback.fromJson(Map<String, dynamic> j) => StudentFeedback(
    enabled: j['enabled'] as bool? ?? false,
    targets: ((j['targets'] as List?) ?? const [])
        .map((e) => FeedbackTarget.fromJson((e as Map).cast<String, dynamic>()))
        .toList(),
  );
}

/// A special-meal notice from the mess (spec §10). Read-only: nothing to tap,
/// acknowledge or dismiss.
class Announcement {
  const Announcement({
    required this.id,
    required this.title,
    this.body,
    this.serviceDate,
    this.mealSlot,
  });

  final String id;
  final String title;
  final String? body;

  /// The day it is about, in the mess's timezone. Null when it is about no
  /// particular day.
  final String? serviceDate;
  final String? mealSlot;

  factory Announcement.fromJson(Map<String, dynamic> j) {
    final body = (j['body'] as String?)?.trim();
    return Announcement(
      id: j['id'] as String? ?? '',
      title: j['title'] as String? ?? '',
      body: body == null || body.isEmpty ? null : body,
      serviceDate: j['serviceDate'] as String?,
      mealSlot: j['mealSlot'] as String?,
    );
  }
}
