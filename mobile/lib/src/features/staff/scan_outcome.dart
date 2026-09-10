/// Scanner outcome vocabulary (§6.4).
///
/// Each domain code maps to a distinct colour, a title, and — separately — what
/// the staff member should do next. The architecture doc is blunt about why: "a
/// generic red X forces staff to debug at the counter with a queue behind them."
///
/// Two flags carry real operational weight:
///
///  - [retryable] — rescanning could plausibly succeed. Offering it when it
///    cannot (a blocked student) has staff rescan the same phone repeatedly
///    while the queue grows.
///  - [allowsManualOverride] — the failure is technical rather than a refusal.
///    The manual fallback runs the *same* eligibility checks, so offering it to
///    a genuinely ineligible student produces the identical refusal while
///    implying it might not.
///
/// Presentation only. Whether to serve is decided on the server; this decides
/// how to say it.
library;

import '../../design/status_badge.dart';
import '../../core/app_info.dart';

class ScanOutcome {
  const ScanOutcome({
    required this.tone,
    required this.title,
    required this.action,
    required this.retryable,
    required this.allowsManualOverride,
  });

  final StatusTone tone;

  /// Large, read at a glance from arm's length.
  final String title;

  /// What to do next — never a restatement of the title.
  final String action;

  final bool retryable;
  final bool allowsManualOverride;
}

/// Client-only code for a scan buffered while offline.
const String kQueuedOffline = 'QUEUED_OFFLINE';

const Map<String, ScanOutcome> kScanOutcomes = {
  'SERVED': ScanOutcome(
    tone: StatusTone.active,
    title: 'Served',
    action: 'Check the photo matches, then wave them through.',
    retryable: false,
    allowsManualOverride: false,
  ),

  // Deliberately informational, not danger. The student is standing there and
  // the scan was valid as far as the counter can tell — staff should serve them
  // and move on. Red here would turn someone away over a Wi-Fi drop, which is
  // the opposite of what the offline queue exists to prevent.
  kQueuedOffline: ScanOutcome(
    tone: StatusTone.neutral,
    title: 'Saved offline',
    action: 'Serve the student. This syncs when the connection returns.',
    retryable: false,
    allowsManualOverride: false,
  ),

  // Warning, not danger: nothing is broken and the student is legitimate — they
  // have simply already eaten this meal.
  'ALREADY_SERVED': ScanOutcome(
    tone: StatusTone.warning,
    title: 'Already served',
    action: 'They have already had this meal today. Send them on.',
    retryable: false,
    allowsManualOverride: false,
  ),

  // Warning rather than danger: the student has done nothing wrong and owes
  // nothing. Red would have staff treat a routine absence as a dispute.
  'SUBSCRIPTION_PAUSED': ScanOutcome(
    tone: StatusTone.warning,
    title: 'Plan paused',
    action: 'Do not serve. The office can tell them when it resumes.',
    retryable: false,
    allowsManualOverride: false,
  ),

  'BLOCKED_UNPAID': ScanOutcome(
    tone: StatusTone.danger,
    title: 'Blocked — unpaid dues',
    action: 'Do not serve. Send them to the mess office.',
    retryable: false,
    allowsManualOverride: false,
  ),

  'NO_ACTIVE_PLAN': ScanOutcome(
    tone: StatusTone.danger,
    title: 'No active plan',
    action:
        'Their plan has expired or does not cover this meal. Send them to the office.',
    retryable: false,
    allowsManualOverride: false,
  ),

  'ON_MESS_CUT': ScanOutcome(
    tone: StatusTone.warning,
    title: 'Meal cancelled',
    action:
        'They cut this meal in advance, so no plate was cooked. Send them to the office.',
    retryable: false,
    allowsManualOverride: false,
  ),

  'OUTSIDE_MEAL_HOURS': ScanOutcome(
    tone: StatusTone.warning,
    title: 'Counter closed',
    action: 'This meal is not being served right now. Check the meal times.',
    retryable: false,
    allowsManualOverride: false,
  ),

  'EXPIRED_TOKEN': ScanOutcome(
    tone: StatusTone.warning,
    title: 'Code expired',
    action: 'Ask them to look at their phone again, then rescan.',
    retryable: true,
    allowsManualOverride: true,
  ),

  'INVALID_TOKEN': ScanOutcome(
    tone: StatusTone.danger,
    title: 'Invalid code',
    action:
        'This is not a valid ${AppInfo.name} code. Rescan, or use manual entry.',
    retryable: true,
    allowsManualOverride: true,
  ),

  'TENANT_MISMATCH': ScanOutcome(
    tone: StatusTone.danger,
    title: 'Wrong mess',
    action: 'This code belongs to a different hostel. Do not serve.',
    retryable: false,
    allowsManualOverride: false,
  ),

  'STUDENT_INACTIVE': ScanOutcome(
    tone: StatusTone.danger,
    title: 'Not an active student',
    action: 'This account has been closed. Send them to the mess office.',
    retryable: false,
    allowsManualOverride: false,
  ),

  'SLOT_NOT_SERVED': ScanOutcome(
    tone: StatusTone.warning,
    title: 'Meal not served here',
    action: 'This mess does not serve that meal. Check the meal times.',
    retryable: false,
    allowsManualOverride: false,
  ),

  'NOT_FOUND': ScanOutcome(
    tone: StatusTone.danger,
    title: 'Student not found',
    action: 'No matching student in this mess. Check the roll number manually.',
    retryable: false,
    allowsManualOverride: true,
  ),

  'INFRASTRUCTURE_ERROR': ScanOutcome(
    tone: StatusTone.danger,
    title: 'Cannot reach the server',
    action: 'Try again. If it keeps failing, serve them using manual entry.',
    retryable: true,
    allowsManualOverride: true,
  ),

  'RATE_LIMITED': ScanOutcome(
    tone: StatusTone.warning,
    title: 'Too many scans',
    action: 'Wait a few seconds and scan again.',
    retryable: true,
    allowsManualOverride: true,
  ),

  'FORBIDDEN': ScanOutcome(
    tone: StatusTone.danger,
    title: 'Not allowed',
    action:
        'This device is not authorised to verify meals. Sign in as counter staff.',
    retryable: false,
    allowsManualOverride: false,
  ),

  'UNAUTHENTICATED': ScanOutcome(
    tone: StatusTone.danger,
    title: 'Signed out',
    action: 'Your session expired. Sign in again to keep serving.',
    retryable: false,
    allowsManualOverride: false,
  ),

  'VALIDATION_FAILED': ScanOutcome(
    tone: StatusTone.danger,
    title: 'Could not read that',
    action: 'Check the details and try again.',
    retryable: true,
    allowsManualOverride: true,
  ),

  'CONFLICT': ScanOutcome(
    tone: StatusTone.warning,
    title: 'Conflicting record',
    action: 'Something changed while you were scanning. Try again.',
    retryable: true,
    allowsManualOverride: true,
  ),
};

/// The unrecognised-code fallback.
///
/// Permissive on purpose: a server that adds a code an older build has never
/// seen must leave staff able to keep serving, so this allows both a retry and
/// the manual fallback rather than dead-ending the counter.
const ScanOutcome kUnknownOutcome = ScanOutcome(
  tone: StatusTone.danger,
  title: 'Could not verify',
  action: 'Try again, or use manual entry.',
  retryable: true,
  allowsManualOverride: true,
);

ScanOutcome outcomeFor(String code) => kScanOutcomes[code] ?? kUnknownOutcome;
