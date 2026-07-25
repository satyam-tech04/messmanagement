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
import type { MessCutSnapshot } from "./headcount.policy";

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

  const subscription = student.subscription;
  if (!subscription || subscription.status !== "ACTIVE") {
    return err(
      domainError("NO_ACTIVE_PLAN", `${student.fullName} has no active meal plan.`, {
        rollNumber: student.rollNumber,
      }),
    );
  }
  if (!isWithinDateRange(serviceDate, subscription.startDate, subscription.endDate)) {
    return err(
      domainError("NO_ACTIVE_PLAN", `${student.fullName}'s plan does not cover today.`, {
        rollNumber: student.rollNumber,
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
