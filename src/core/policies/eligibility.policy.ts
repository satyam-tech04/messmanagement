/**
 * Meal eligibility — "may this student eat this meal today?"
 *
 * Extracted so that **issuance and verification ask the identical question**.
 * §6.1 requires the check at both points, and §7.4 explains why: a student who
 * pays at 11pm must eat lunch tomorrow without waiting for a nightly job. Two
 * separate implementations would inevitably drift, and the drift would show up
 * as a student holding a valid-looking code that the counter refuses — the worst
 * possible place to discover an inconsistency.
 *
 * Pure. The caller fetches the student and any mess cuts; this decides.
 */
import type { MealSlot } from "../domain/enums";
import { domainError, type DomainError } from "../errors";
import { err, ok, type Result } from "../result";
import { isWithinDateRange, type ServiceDate } from "../time";
import type { StudentForVerification } from "../ports/repositories";
import { isCutFromMeal } from "./headcount.policy";
import { activePauseOn } from "./pause.policy";
import type { MessCutSnapshot } from "./headcount.policy";
import type { ServiceSlot } from "./menu.policy";

type SubscriptionForVerification = NonNullable<StudentForVerification["subscription"]>;

/**
 * A student's ACTIVE subscriptions, from either repository shape.
 *
 * Since migration 017 a renewal means several may be ACTIVE at once — including
 * a term that has already ended, because nothing flips the column when time
 * passes. Every caller must pick the one covering the date in question, never
 * the first.
 */
export function activeSubscriptionsOf(
  student: StudentForVerification,
): readonly SubscriptionForVerification[] {
  const all =
    student.subscriptions && student.subscriptions.length > 0
      ? student.subscriptions
      : student.subscription
        ? [student.subscription]
        : [];
  return all.filter((s) => s.status === "ACTIVE");
}

/**
 * The meal a student's code should be for.
 *
 * The soonest of `candidates` (see `serviceSlotsInOrder`) that the plan covering
 * that day actually includes. A lunch-and-dinner subscriber at breakfast time is
 * shown their lunch code rather than refused for a meal they never bought.
 *
 * Falls back to the soonest candidate when no plan includes any of them, so the
 * eligibility check then explains why — no plan, lapsed, or the wrong meals —
 * instead of the screen showing nothing at all.
 */
export function mealToShow(
  candidates: readonly ServiceSlot[],
  subscriptions: readonly Pick<
    SubscriptionForVerification,
    "status" | "startDate" | "endDate" | "includedMealSlots"
  >[],
): ServiceSlot | undefined {
  const included = candidates.find((candidate) =>
    subscriptions.some(
      (s) =>
        s.status === "ACTIVE" &&
        isWithinDateRange(candidate.serviceDate, s.startDate, s.endDate) &&
        s.includedMealSlots.includes(candidate.slot),
    ),
  );
  return included ?? candidates[0];
}

export interface EligibilityInput {
  readonly student: StudentForVerification;
  readonly expectedTenantId: string;
  readonly mealSlot: MealSlot;
  readonly serviceDate: ServiceDate;
  readonly cuts: readonly MessCutSnapshot[];
}

/**
 * Decides eligibility, returning the student on success.
 *
 * Error codes are part of the contract with the scanner UI (§6.4): each renders
 * a different colour and message, because a generic red X forces staff to debug
 * at the counter with a queue behind them.
 */
export function checkMealEligibility(
  input: EligibilityInput,
): Result<StudentForVerification, DomainError> {
  const { student, mealSlot, serviceDate } = input;

  // Defence in depth. RLS should make this unreachable; if it is ever reached,
  // something is badly wrong and nothing may proceed.
  if (student.tenantId !== input.expectedTenantId) {
    return err(domainError("TENANT_MISMATCH", "Student belongs to a different mess."));
  }

  if (student.status === "BLOCKED") {
    return err(
      domainError("BLOCKED_UNPAID", `${student.fullName} is blocked for unpaid dues.`, {
        rollNumber: student.rollNumber,
      }),
    );
  }
  if (student.status === "INACTIVE") {
    return err(
      domainError("STUDENT_INACTIVE", `${student.fullName} is no longer an active student.`, {
        rollNumber: student.rollNumber,
      }),
    );
  }
  // GRACE deliberately passes: the grace period exists so a student with unpaid
  // dues keeps eating for a few days rather than being cut off overnight.

  const activeSubs = activeSubscriptionsOf(student);
  if (activeSubs.length === 0) {
    return err(
      domainError("NO_ACTIVE_PLAN", `${student.fullName} has no active meal plan.`, {
        rollNumber: student.rollNumber,
      }),
    );
  }

  // Pick the active subscription covering this specific service date. When a student
  // renews early they hold consecutive active terms; this picks the one for this meal.
  const subscription = activeSubs.find((s) =>
    isWithinDateRange(serviceDate, s.startDate, s.endDate),
  );
  if (!subscription) {
    return err(
      domainError("NO_ACTIVE_PLAN", `${student.fullName}'s plan does not cover today.`, {
        rollNumber: student.rollNumber,
      }),
    );
  }
  // An admin paused this plan. Checked here rather than in each caller so the
  // student's phone, the counter scanner and the manual fallback all refuse
  // identically — spec §19 is explicit that hiding the scanner is not enough.
  //
  // Against the meal's service_date, never `now()`: a dinner served at 00:30
  // belongs to the day it started, so a pause beginning "tomorrow" must not
  // refuse a meal that is still part of today.
  const pause = activePauseOn(subscription.pauses, serviceDate);
  if (pause) {
    return err(
      domainError("SUBSCRIPTION_PAUSED", `${student.fullName}'s plan is paused.`, {
        rollNumber: student.rollNumber,
        // Both dates: §12 and §24 require the student to see when the pause
        // began as well as when they eat again.
        startDate: pause.startDate,
        resumeDate: pause.resumeDate,
      }),
    );
  }

  if (!subscription.includedMealSlots.includes(mealSlot)) {
    return err(
      domainError("NO_ACTIVE_PLAN", `${student.fullName}'s plan does not include this meal.`, {
        rollNumber: student.rollNumber,
        slot: mealSlot,
      }),
    );
  }

  // An approved cut means the student opted out and the kitchen did not cook
  // for them. Serving anyway would silently break the headcount they were
  // credited against.
  const activeCut = input.cuts.find((cut) => isCutFromMeal(cut, serviceDate, mealSlot));
  if (activeCut) {
    return err(
      domainError("ON_MESS_CUT", `${student.fullName} has cancelled this meal.`, {
        rollNumber: student.rollNumber,
      }),
    );
  }

  return ok(student);
}
