/**
 * Plan and subscription policy (§4.2, §7.1).
 *
 * Two decisions live here:
 *
 *   1. What makes a plan draft valid — including the rupee → paise conversion,
 *      which is the only place a decimal is allowed anywhere near money.
 *   2. What a subscription activation freezes, and when it must be refused.
 *
 * The snapshot rule is the important one. A subscription stores the price and
 * meal slots **as they were at activation**. Reading them back off the plan
 * would mean an owner raising next month's price silently rewrites what every
 * existing student agreed to — and every credit already issued against it.
 */
import {
  ALL_MEAL_SLOTS,
  type MealSlot,
  type PlanDuration,
  type StudentStatus,
  type UserRole,
} from "@/core/domain/enums";
import { domainError, forbidden, type DomainError } from "@/core/errors";
import { perMealPaise, rupeesToPaise, type Paise } from "@/core/money";
import { err, ok, type Result } from "@/core/result";
import { subscriptionPeriodFor } from "@/core/policies/student-admin.policy";
import type { ServiceDate } from "@/core/time";

/** Matches the 1–400 day CHECK constraint on `plans.duration_days`. */
const MAX_DURATION_DAYS = 400;

function isAdmin(role: UserRole): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

// --- Plan drafts ----------------------------------------------------------

export interface PlanDraftInput {
  readonly actorRole: UserRole;
  readonly name: string;
  /** As typed by the admin, in rupees. Converted here and nowhere else. */
  readonly priceRupees: number;
  readonly durationType: PlanDuration;
  readonly durationDays: number;
  readonly mealSlots: readonly MealSlot[];
  /**
   * The slots this mess actually serves, from tenant settings.
   *
   * A plan promising a meal with no window is a promise the mess cannot keep,
   * and it corrupts the per-meal rate — see the check below.
   */
  readonly servedSlots: readonly MealSlot[];
}

export interface PlanDraft {
  readonly name: string;
  readonly pricePaise: Paise;
  readonly durationType: PlanDuration;
  readonly durationDays: number;
  readonly mealSlots: readonly MealSlot[];
}

export function parsePlanDraft(input: PlanDraftInput): Result<PlanDraft, DomainError> {
  if (!isAdmin(input.actorRole)) {
    return err(forbidden("Only an admin can create or edit plans."));
  }

  const name = input.name.trim();
  if (name.length === 0) {
    return err(domainError("VALIDATION_FAILED", "Give the plan a name."));
  }
  if (name.length > 120) {
    return err(domainError("VALIDATION_FAILED", "The plan name is too long."));
  }

  if (!Number.isFinite(input.priceRupees) || input.priceRupees < 0) {
    return err(domainError("VALIDATION_FAILED", "Enter a valid price."));
  }

  // Reject sub-paise precision rather than rounding it away: an admin who typed
  // 4000.567 meant something, and silently charging 4000.57 is a decision the
  // product should not make on their behalf.
  const paiseExact = input.priceRupees * 100;
  if (Math.abs(paiseExact - Math.round(paiseExact)) > 1e-6) {
    return err(domainError("VALIDATION_FAILED", "A price cannot be finer than one paise."));
  }

  let pricePaise: Paise;
  try {
    pricePaise = rupeesToPaise(input.priceRupees);
  } catch {
    return err(domainError("VALIDATION_FAILED", "That price is too large."));
  }

  if (!Number.isInteger(input.durationDays) || input.durationDays < 1) {
    return err(domainError("VALIDATION_FAILED", "The duration must be at least one day."));
  }
  if (input.durationDays > MAX_DURATION_DAYS) {
    return err(
      domainError("VALIDATION_FAILED", `The duration cannot exceed ${MAX_DURATION_DAYS} days.`),
    );
  }

  const mealSlots = normalizeMealSlots(input.mealSlots);
  if (mealSlots.length === 0) {
    return err(domainError("VALIDATION_FAILED", "Choose at least one meal for this plan."));
  }

  // Two things go wrong when a plan includes a meal the mess does not serve.
  //
  // The student is told their plan covers breakfast, no breakfast window
  // exists, and they are refused at a counter that never opens. And the
  // per-meal rate divides the price by slots x days, so counting an
  // unclaimable meal understates the rate — a 5,200 plan over 90 days reads as
  // 14.44 a meal instead of 28.88, and every mess-cut credit derived from it
  // would be wrong.
  const unserved = mealSlots.filter((slot) => !input.servedSlots.includes(slot));
  if (unserved.length > 0) {
    const names = unserved.map((s) => s.toLowerCase()).join(" and ");
    return err(
      domainError(
        "SLOT_NOT_SERVED",
        `This mess does not serve ${names}. Either untick ${unserved.length > 1 ? "them" : "it"}, or add the meal times under Settings first.`,
        { slots: unserved.join(",") },
      ),
    );
  }

  return ok({
    name,
    pricePaise,
    durationType: input.durationType,
    durationDays: input.durationDays,
    mealSlots,
  });
}

/**
 * De-duplicates and orders slots by time of day.
 *
 * Ordering here means "Lunch, Dinner" renders identically no matter which order
 * the admin ticked the boxes, so two identical plans never *look* different.
 */
function normalizeMealSlots(slots: readonly MealSlot[]): readonly MealSlot[] {
  const present = new Set(slots);
  return ALL_MEAL_SLOTS.filter((slot) => present.has(slot));
}

/**
 * Total meals a plan covers over its full period — the denominator for the
 * per-meal rate that mess-cut credits are derived from (§7.1).
 */
export function planMealsInPeriod(slotCount: number, durationDays: number): number {
  if (!Number.isInteger(slotCount) || slotCount < 1) {
    throw new RangeError(`slotCount must be a positive integer, received ${slotCount}`);
  }
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    throw new RangeError(`durationDays must be a positive integer, received ${durationDays}`);
  }
  return slotCount * durationDays;
}

// --- Activation -----------------------------------------------------------

export interface ActivationPlan {
  readonly id: string;
  readonly isActive: boolean;
  readonly pricePaise: Paise;
  readonly durationDays: number;
  readonly mealSlots: readonly MealSlot[];
}

export interface ActivationRequest {
  readonly actorRole: UserRole;
  readonly studentStatus: StudentStatus;
  /** Checked in the database too, by a partial unique index; this is the friendly path. */
  readonly hasActiveSubscription: boolean;
  readonly plan: ActivationPlan;
  readonly timeZone: string;
  readonly now: Date;
  /** Overrides "today" when backdating. */
  readonly startDate?: ServiceDate;
}

export interface SubscriptionActivation {
  readonly planId: string;
  readonly pricePaiseSnapshot: Paise;
  readonly mealSlotsSnapshot: readonly MealSlot[];
  readonly startDate: ServiceDate;
  readonly endDate: ServiceDate;
  /** Informational: the rate future credits will be computed at. */
  readonly perMealPaise: Paise;
}

export function activateSubscription(
  request: ActivationRequest,
): Result<SubscriptionActivation, DomainError> {
  const { actorRole, studentStatus, plan } = request;

  if (!isAdmin(actorRole)) {
    return err(forbidden("Only an admin can assign a meal plan."));
  }

  // A student who has left should not be quietly signed up again; re-activate
  // them first, so the decision to re-admit is explicit and audited.
  if (studentStatus === "INACTIVE") {
    return err(
      domainError("STUDENT_INACTIVE", "This student is inactive. Re-activate them first."),
    );
  }

  // BLOCKED is deliberately allowed: paying for a new plan is precisely how a
  // blocked student gets themselves unblocked.

  if (!plan.isActive) {
    return err(
      domainError("VALIDATION_FAILED", "That plan is no longer offered. Choose an active plan."),
    );
  }

  if (request.hasActiveSubscription) {
    return err(
      domainError(
        "CONFLICT",
        "This student already has an active plan. End it before assigning another.",
      ),
    );
  }

  const period = subscriptionPeriodFor({
    timeZone: request.timeZone,
    now: request.now,
    durationDays: plan.durationDays,
    ...(request.startDate ? { startDate: request.startDate } : {}),
  });

  // Copied, not referenced: a later mutation of the plan object must not reach
  // back into a subscription that has already been agreed.
  const mealSlotsSnapshot = [...plan.mealSlots];

  const meals = planMealsInPeriod(mealSlotsSnapshot.length, plan.durationDays);

  return ok({
    planId: plan.id,
    pricePaiseSnapshot: plan.pricePaise,
    mealSlotsSnapshot,
    startDate: period.startDate,
    endDate: period.endDate,
    perMealPaise: perMealPaise(plan.pricePaise, meals),
  });
}
