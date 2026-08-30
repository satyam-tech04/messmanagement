/**
 * Subscription pauses — the admin-facing "grace period" (new-features spec).
 *
 * ## Why this is not called a grace period in code
 *
 * `student_status.GRACE` already exists and means the opposite thing: a student
 * with unpaid dues who is *still allowed to eat*, so they are not cut off
 * overnight. `eligibility.policy.ts` says so explicitly — "GRACE deliberately
 * passes". This feature pauses a subscription and must *deny* meals. Sharing a
 * name with the inverse rule is how a paused student gets fed, or a student in
 * dues-grace gets refused in front of a queue, so the two never touch.
 *
 * ## The rule that shapes everything here
 *
 * Spec §22 requires that editing a pause repeatedly must not extend the
 * subscription repeatedly, and does not say how. It cannot be done from the
 * subscription's current end date, because nothing distinguishes "this end date
 * was pushed out by the last pause edit" from "an admin moved it by hand for an
 * unrelated reason".
 *
 * So every calculation anchors on `endDateBeforePause`: the subscription's end
 * date at the instant the pause was *first* created, stored on the pause row
 * and passed back in on every subsequent edit. Then:
 *
 *     end date = endDateBeforePause + days actually paused
 *
 * is idempotent — the fourth edit produces the same answer as the first. It
 * also gives cancel (§17) and early resume (§16) their answers for free, since
 * both are just a different value for "days actually paused". One anchor,
 * three requirements.
 *
 * ## Half-open dates
 *
 * §21: the paused period is `[startDate, resumeDate)`. The start date is the
 * first paused day, the resume date is the first day the student eats again and
 * is never itself a paused day. Every function here follows that, and the
 * boundary is tested from both sides.
 */
import type { UserRole } from "@/core/domain/enums";
import { domainError, forbidden, illegalTransition, type DomainError } from "@/core/errors";
import { err, ok, type Result } from "@/core/result";
import { subscriptionStateOf, type SubscriptionDates } from "@/core/policies/subscription-state";
import { addDays, compareServiceDates, differenceInDays, type ServiceDate } from "@/core/time";

/** Longest pause an admin can configure in one go. A year of "leave" is a typo. */
const MAX_PAUSE_DAYS = 365;

const MAX_REMARKS_LENGTH = 500;

function isAdmin(role: UserRole): boolean {
  // SUPER_ADMIN included deliberately: it is the account that supports
  // customers, and this is the feature most likely to generate a support call.
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

export type PauseState = "SCHEDULED" | "RUNNING" | "COMPLETED" | "CANCELLED";

/**
 * The stored shape of a pause.
 *
 * `status` holds only what somebody *decided* — ACTIVE or CANCELLED. Whether a
 * live pause is scheduled, running or finished is derived from the dates, never
 * stored.
 *
 * That is not a stylistic preference. This project has one cron job and it
 * snapshots headcounts; there is nothing to flip a status column when a date
 * arrives. The same mistake already bit subscriptions, whose rows sat at ACTIVE
 * for months after they ended, which is why `subscription-state.ts` exists.
 * Deriving means AC9's "the subscription resumes automatically on the resume
 * date" is true because nothing has to run.
 */
export interface PauseRecord {
  readonly status: string;
  /** First paused day, inclusive. */
  readonly startDate: ServiceDate;
  /** First active day again, exclusive from the pause. */
  readonly resumeDate: ServiceDate;
}

/** A pause plus the anchor every recalculation needs. */
export interface AnchoredPause extends PauseRecord {
  readonly endDateBeforePause: ServiceDate;
}

export function pauseStateOf(pause: PauseRecord, today: ServiceDate): PauseState {
  if (pause.status === "CANCELLED") return "CANCELLED";
  if (compareServiceDates(today, pause.startDate) < 0) return "SCHEDULED";
  // Half-open: on the resume date the pause is over.
  if (compareServiceDates(today, pause.resumeDate) >= 0) return "COMPLETED";
  return "RUNNING";
}

export function pauseStateLabel(state: PauseState): string {
  switch (state) {
    case "SCHEDULED":
      return "Scheduled";
    case "RUNNING":
      return "Paused";
    case "COMPLETED":
      return "Ended";
    case "CANCELLED":
      return "Cancelled";
  }
}

/** Days the subscription is paused for. §5.3: `resumeDate - startDate`. */
export function graceDays(startDate: ServiceDate, resumeDate: ServiceDate): number {
  return Math.max(0, differenceInDays(startDate, resumeDate));
}

/**
 * Whether this pause stops a meal on `date`.
 *
 * The counter's question, and the student's phone's question — both run this
 * through `checkMealEligibility`, so there is one answer and no way to hold a
 * valid-looking code the counter refuses.
 */
export function isPausedOn(pause: PauseRecord, date: ServiceDate): boolean {
  if (pause.status === "CANCELLED") return false;
  return (
    compareServiceDates(date, pause.startDate) >= 0 &&
    compareServiceDates(date, pause.resumeDate) < 0
  );
}

/**
 * The pause covering `date`, if any.
 *
 * A list rather than a single row because a student may legitimately go home in
 * September and again in November. The database forbids *overlapping* pauses,
 * not repeated ones, so at most one can match.
 */
export function activePauseOn<T extends PauseRecord>(
  pauses: readonly T[],
  date: ServiceDate,
): T | null {
  return pauses.find((pause) => isPausedOn(pause, date)) ?? null;
}

// ---------------------------------------------------------------------------
// Creating and modifying — §5, §14, §15, §19
// ---------------------------------------------------------------------------

export interface PauseDraftInput {
  readonly actorRole: UserRole;
  readonly subscription: SubscriptionDates;
  readonly startDate: ServiceDate;
  readonly resumeDate: ServiceDate;
  readonly today: ServiceDate;
  readonly remarks: string;
  /**
   * The end date the admin typed. Omitted means "accept what the system
   * computed" — §7 forbids silently replacing an entered value, not computing a
   * default.
   */
  readonly subscriptionEndDate?: ServiceDate;
  /**
   * Present when modifying an existing pause: the anchor already stored on it.
   * Absent on creation, where the subscription's current end date becomes the
   * anchor. This single field is what makes §22 hold.
   */
  readonly endDateBeforePause?: ServiceDate;
}

export interface PauseDraft {
  readonly startDate: ServiceDate;
  readonly resumeDate: ServiceDate;
  readonly graceDays: number;
  readonly endDateBeforePause: ServiceDate;
  /** What the system worked out: anchor + graceDays. Stored for comparison. */
  readonly computedEndDate: ServiceDate;
  /** What to write to `subscriptions.end_date` — the admin's value if they gave one. */
  readonly subscriptionEndDate: ServiceDate;
  readonly isEndDateOverridden: boolean;
  readonly remarks: string;
}

export function parsePauseDraft(input: PauseDraftInput): Result<PauseDraft, DomainError> {
  const { actorRole, subscription, startDate, resumeDate, today } = input;

  if (!isAdmin(actorRole)) {
    return err(forbidden("Only an admin can pause a subscription."));
  }

  // --- Is there anything left to pause? (§3, and F11 — §3 forgot expired) ---
  const state = subscriptionStateOf(subscription, today);
  if (state === "CANCELLED") {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "This plan has been cancelled, so there is nothing to pause.",
      ),
    );
  }
  if (state === "EXPIRED") {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "This plan has already ended, so there is nothing to pause.",
      ),
    );
  }

  // --- Start date (§5.1, as amended by D-15) ---
  //
  // The spec rejects today as well as the past. The owner overrode that: an
  // admin who learns at 9am that a student went home this morning must be able
  // to act now, rather than watch them eat for another day.
  if (compareServiceDates(startDate, today) < 0) {
    return err(
      domainError("VALIDATION_FAILED", "A pause cannot start in the past.", { startDate }),
    );
  }
  if (compareServiceDates(startDate, subscription.startDate) < 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `This plan does not begin until ${subscription.startDate}. A pause cannot start before it.`,
        { startDate, planStart: subscription.startDate },
      ),
    );
  }
  if (compareServiceDates(startDate, subscription.endDate) > 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `This plan ends on ${subscription.endDate}. A pause cannot start after it.`,
        { startDate, planEnd: subscription.endDate },
      ),
    );
  }

  // --- Resume date (§5.2, AC4) ---
  if (compareServiceDates(resumeDate, startDate) <= 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "The resume date must be after the start date — the student eats again on the resume date.",
        { startDate, resumeDate },
      ),
    );
  }

  const days = graceDays(startDate, resumeDate);
  if (days > MAX_PAUSE_DAYS) {
    return err(
      domainError("VALIDATION_FAILED", `A pause cannot run longer than ${MAX_PAUSE_DAYS} days.`, {
        graceDays: days,
      }),
    );
  }

  // --- Remarks (§4, §20) ---
  //
  // Required, matching `endSubscription`, which already refuses to cancel a
  // plan without a reason. Pausing one is comparably consequential and the
  // remark is what an admin reads back in three months.
  const remarks = input.remarks.trim();
  if (remarks.length < 3) {
    return err(domainError("VALIDATION_FAILED", "Give a reason for the pause."));
  }
  if (remarks.length > MAX_REMARKS_LENGTH) {
    return err(domainError("VALIDATION_FAILED", "That reason is too long."));
  }

  // --- The end date (§7, §8, §22 — see the module comment) ---
  const endDateBeforePause = input.endDateBeforePause ?? subscription.endDate;
  const computedEndDate = addDays(endDateBeforePause, days);
  const subscriptionEndDate = input.subscriptionEndDate ?? computedEndDate;

  // An end date before the student is allowed to eat again is not a plan, it is
  // a typo — and it would leave a paying student unservable with nothing on
  // screen to explain it.
  if (compareServiceDates(subscriptionEndDate, resumeDate) < 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `The plan would end on ${subscriptionEndDate}, before the student resumes on ${resumeDate}.`,
        { subscriptionEndDate, resumeDate },
      ),
    );
  }

  return ok({
    startDate,
    resumeDate,
    graceDays: days,
    endDateBeforePause,
    computedEndDate,
    subscriptionEndDate,
    isEndDateOverridden: subscriptionEndDate !== computedEndDate,
    remarks,
  });
}

// ---------------------------------------------------------------------------
// Early resume — §16, AC14
// ---------------------------------------------------------------------------

export interface EarlyResumeInput {
  readonly actorRole: UserRole;
  readonly pause: AnchoredPause;
  /** The day the student starts eating again — usually today. */
  readonly resumeOn: ServiceDate;
  readonly today: ServiceDate;
}

export interface EarlyResume {
  readonly resumeDate: ServiceDate;
  /** Days *actually* paused, which is the whole point of §16. */
  readonly graceDays: number;
  readonly subscriptionEndDate: ServiceDate;
}

export function resumePauseEarly(input: EarlyResumeInput): Result<EarlyResume, DomainError> {
  const { actorRole, pause, resumeOn, today } = input;

  if (!isAdmin(actorRole)) {
    return err(forbidden("Only an admin can resume a paused subscription."));
  }

  const state = pauseStateOf(pause, today);
  if (state !== "RUNNING") {
    // §17 is explicit: a pause that has not started is cancelled, not resumed.
    // Keeping the two apart means "resume early" always has actual paused days
    // to account for.
    return err(illegalTransition("Pause", pauseStateLabel(state), "Resumed early"));
  }

  if (compareServiceDates(resumeOn, pause.startDate) < 0) {
    return err(
      domainError("VALIDATION_FAILED", "A pause cannot be resumed before it started.", {
        resumeOn,
        startDate: pause.startDate,
      }),
    );
  }
  if (compareServiceDates(resumeOn, pause.resumeDate) > 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `This pause already ends on ${pause.resumeDate}. To push it out, extend it instead.`,
        { resumeOn, resumeDate: pause.resumeDate },
      ),
    );
  }

  // Only the days actually paused are given back. Unused future days must not
  // keep extending the subscription — that is §16's entire requirement.
  const days = graceDays(pause.startDate, resumeOn);

  return ok({
    resumeDate: resumeOn,
    graceDays: days,
    subscriptionEndDate: addDays(pause.endDateBeforePause, days),
  });
}

// ---------------------------------------------------------------------------
// Cancelling — §17, AC13
// ---------------------------------------------------------------------------

export interface CancelPauseInput {
  readonly actorRole: UserRole;
  readonly pause: AnchoredPause;
  readonly today: ServiceDate;
}

export interface CancelledPause {
  /** The anchor, restored exactly. §17: "the subscription remains unchanged." */
  readonly subscriptionEndDate: ServiceDate;
}

export function cancelPause(input: CancelPauseInput): Result<CancelledPause, DomainError> {
  const { actorRole, pause, today } = input;

  if (!isAdmin(actorRole)) {
    return err(forbidden("Only an admin can cancel a pause."));
  }

  const state = pauseStateOf(pause, today);
  if (state !== "SCHEDULED") {
    return err(illegalTransition("Pause", pauseStateLabel(state), "Cancelled"));
  }

  return ok({ subscriptionEndDate: pause.endDateBeforePause });
}
