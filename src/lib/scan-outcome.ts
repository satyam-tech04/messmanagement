/**
 * Scanner outcome vocabulary (§6.4).
 *
 * Each domain error code maps to a distinct colour, a title, and — separately —
 * what the staff member should do next. The architecture doc is blunt about
 * why: "a generic red X forces staff to debug at the counter with a queue
 * behind them."
 *
 * Two flags carry real operational weight:
 *
 *   `retryable` — rescanning could plausibly succeed. Offering it when it
 *   cannot (a blocked student) has staff rescan the same phone repeatedly while
 *   the queue grows.
 *
 *   `allowsManualOverride` — the failure is technical rather than a refusal.
 *   The manual fallback runs the *same* eligibility checks, so offering it to a
 *   genuinely ineligible student would produce the identical refusal while
 *   implying it might not.
 *
 * Presentation only, so it lives in `src/lib` (a leaf). The decision of whether
 * to serve is made in core; this decides how to say it.
 */
import type { StatusTone } from "./tone";

export interface ScanOutcome {
  readonly tone: StatusTone;
  /** Large, read at a glance from arm's length. */
  readonly title: string;
  /** What to do next — never a restatement of the title. */
  readonly action: string;
  readonly retryable: boolean;
  readonly allowsManualOverride: boolean;
}

export const ALL_SCAN_OUTCOMES: Readonly<Record<string, ScanOutcome>> = {
  SERVED: {
    tone: "success",
    title: "Served",
    action: "Check the photo matches, then wave them through.",
    retryable: false,
    allowsManualOverride: false,
  },

  /**
   * Client-only: the scan could not reach the server and was buffered.
   *
   * Deliberately `info`, not `danger`. The student is standing there and the
   * scan was valid as far as the counter can tell — staff should serve them and
   * move on. Red here would have them turned away over a Wi-Fi drop, which is
   * the opposite of what the offline queue exists to prevent.
   */
  QUEUED_OFFLINE: {
    tone: "info",
    title: "Saved offline",
    action: "Serve the student. This syncs automatically when the connection returns.",
    retryable: false,
    allowsManualOverride: false,
  },

  ALREADY_SERVED: {
    // Warning, not danger: nothing is broken and the student is legitimate —
    // they have simply already eaten this meal.
    tone: "warning",
    title: "Already served",
    action: "They have already had this meal today. Send them on.",
    retryable: false,
    allowsManualOverride: false,
  },

  BLOCKED_UNPAID: {
    tone: "danger",
    title: "Blocked — unpaid dues",
    action: "Do not serve. Send them to the mess office.",
    retryable: false,
    allowsManualOverride: false,
  },

  NO_ACTIVE_PLAN: {
    tone: "danger",
    title: "No active plan",
    action: "Their plan has expired or does not cover this meal. Send them to the office.",
    retryable: false,
    allowsManualOverride: false,
  },

  ON_MESS_CUT: {
    tone: "warning",
    title: "Meal cancelled",
    action: "They cut this meal in advance, so no plate was cooked. Send them to the office.",
    retryable: false,
    allowsManualOverride: false,
  },

  OUTSIDE_MEAL_HOURS: {
    tone: "warning",
    title: "Counter closed",
    action: "This meal is not being served right now. Check the meal times.",
    retryable: false,
    allowsManualOverride: false,
  },

  EXPIRED_TOKEN: {
    // The commonest denial by far, and the most harmless: a student held their
    // phone up a few seconds too long.
    tone: "warning",
    title: "Code expired",
    action: "Ask them to look at their phone again, then rescan.",
    retryable: true,
    allowsManualOverride: true,
  },

  INVALID_TOKEN: {
    tone: "danger",
    title: "Invalid code",
    action: "This is not a valid Mess OS code. Rescan, or use manual entry.",
    retryable: true,
    allowsManualOverride: true,
  },

  TENANT_MISMATCH: {
    tone: "danger",
    title: "Wrong mess",
    action: "This code belongs to a different hostel. Do not serve.",
    retryable: false,
    allowsManualOverride: false,
  },

  STUDENT_INACTIVE: {
    tone: "danger",
    title: "Not an active student",
    action: "This account has been closed. Send them to the mess office.",
    retryable: false,
    allowsManualOverride: false,
  },

  SLOT_NOT_SERVED: {
    tone: "warning",
    title: "Meal not served here",
    action: "This mess does not serve that meal. Check the meal times.",
    retryable: false,
    allowsManualOverride: false,
  },

  NOT_FOUND: {
    tone: "danger",
    title: "Student not found",
    action: "No matching student in this mess. Check the roll number manually.",
    retryable: false,
    allowsManualOverride: true,
  },

  INFRASTRUCTURE_ERROR: {
    // Fails closed (§2.7). The manual fallback is exactly what this is for.
    tone: "danger",
    title: "Cannot reach the server",
    action: "Try again. If it keeps failing, serve them using manual entry.",
    retryable: true,
    allowsManualOverride: true,
  },

  RATE_LIMITED: {
    tone: "warning",
    title: "Too many scans",
    action: "Wait a few seconds and scan again.",
    retryable: true,
    allowsManualOverride: true,
  },

  FORBIDDEN: {
    tone: "danger",
    title: "Not allowed",
    action: "This device is not authorised to verify meals. Sign in as counter staff.",
    retryable: false,
    allowsManualOverride: false,
  },

  UNAUTHENTICATED: {
    tone: "danger",
    title: "Signed out",
    action: "Your session expired. Sign in again to keep serving.",
    retryable: false,
    allowsManualOverride: false,
  },

  VALIDATION_FAILED: {
    tone: "danger",
    title: "Could not read that",
    action: "Check the details and try again.",
    retryable: true,
    allowsManualOverride: true,
  },

  CONFLICT: {
    tone: "warning",
    title: "Conflicting record",
    action: "Something changed while you were scanning. Try again.",
    retryable: true,
    allowsManualOverride: true,
  },
} as const;

/**
 * Unknown codes fail safe rather than blank: a domain error added later must
 * still render something a staff member can act on.
 */
const UNKNOWN: ScanOutcome = {
  tone: "danger",
  title: "Scan failed",
  action: "Try again. If it keeps failing, serve them using manual entry.",
  retryable: true,
  allowsManualOverride: true,
};

export function scanOutcomeFor(code: string): ScanOutcome {
  return ALL_SCAN_OUTCOMES[code] ?? UNKNOWN;
}
