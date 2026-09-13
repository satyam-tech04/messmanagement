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
import { perMealPaise, type Paise } from "@/core/money";
import { err, ok, type Result } from "@/core/result";
import { validateSubscriptionStart } from "@/core/policies/student-admin.policy";
import { subscriptionStateOf, type SubscriptionDates } from "@/core/policies/subscription-state";
import { addDays, compareServiceDates, serviceDateOf, type ServiceDate } from "@/core/time";
import { parseAssignmentPricing, parsePlanPricing } from "@/core/policies/pricing.policy";

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
  /**
   * How the price was arrived at (migration 014).
   *
   * Optional so that every caller predating the pricing engine keeps working:
   * when absent, the base premium *is* the price and the discount is zero,
   * which is exactly what the backfill wrote for the 14 existing plans. When
   * present, these two define the price and `priceRupees` is ignored.
   */
  readonly basePremiumRupees?: number;
  readonly discountRupees?: number;
}

export interface PlanDraft {
  readonly name: string;
  /** `base − discount`. The plan's authoritative price. */
  readonly pricePaise: Paise;
  readonly basePremiumPaise: Paise;
  readonly discountPaise: Paise;
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

  // Two ways in. A form that knows about base premium and discount sends both,
  // and they define the price. Anything older sends a price, and it becomes the
  // base premium with no discount — the same shape migration 014 backfilled.
  const usesPricing = input.basePremiumRupees !== undefined || input.discountRupees !== undefined;

  const priced = parsePlanPricing({
    actorRole: input.actorRole,
    basePremiumRupees: usesPricing ? (input.basePremiumRupees ?? 0) : input.priceRupees,
    discountRupees: usesPricing ? (input.discountRupees ?? 0) : 0,
  });
  if (!priced.ok) return priced;

  const pricePaise = priced.value.finalPricePaise;

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
    basePremiumPaise: priced.value.basePremiumPaise,
    discountPaise: priced.value.discountPaise,
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

/**
 * The first existing subscription whose days collide with `[startDate, endDate]`.
 *
 * Inclusive at both ends, matching how a subscription is read everywhere else:
 * a 30-day plan from the 1st runs through the 30th.
 */
export function overlappingPeriod(
  existing: readonly SubscriptionDates[],
  startDate: ServiceDate,
  endDate: ServiceDate,
): SubscriptionDates | null {
  return (
    existing.find((other) => {
      // Deliberately matches the exclusion constraint's WHERE clause, so the
      // policy and the database can never disagree about what blocks what.
      if (other.status !== "ACTIVE" && other.status !== "PENDING_PAYMENT") return false;
      return (
        compareServiceDates(startDate, other.endDate) <= 0 &&
        compareServiceDates(endDate, other.startDate) >= 0
      );
    }) ?? null
  );
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
  /**
   * Every subscription this student already holds.
   *
   * Replaces an earlier `hasActiveSubscription` boolean. That flag was a proxy
   * for a partial unique index allowing one ACTIVE row per student, and the
   * proxy was wrong: the real rule is that no two subscriptions may cover the
   * same DAY. Consecutive terms are exactly what a renewal is, and the boolean
   * made the commonest one — paying on the 25th for a term starting the 1st —
   * impossible to express.
   *
   * Mirrored by the exclusion constraint in migration 017, which is the real
   * guarantee when two admins act at once.
   */
  readonly existingPeriods?: readonly SubscriptionDates[];
  readonly plan: ActivationPlan;
  readonly timeZone: string;
  readonly now: Date;
  /** Overrides "today" when backdating. */
  readonly startDate?: ServiceDate;
  /**
   * Calendar days this student is actually buying. Defaults to the plan's own
   * duration, which is what every caller did before pro-rating existed.
   */
  readonly assignmentDurationDays?: number;
  /** An admin's own figure, replacing the pro-rated one (D-17). */
  readonly overrideRupees?: number;
}

export interface SubscriptionActivation {
  readonly planId: string;
  /** What this student is charged — pro-rated, and overridden if the admin said so. */
  readonly pricePaiseSnapshot: Paise;
  readonly mealSlotsSnapshot: readonly MealSlot[];
  /** The plan's own term, frozen so the price can be explained later. */
  readonly planDurationDaysSnapshot: number;
  /** The days actually bought. Drives the end date and the per-meal rate. */
  readonly assignmentDurationDays: number;
  /** What the formula produced, kept even when overridden. */
  readonly calculatedPricePaise: Paise;
  readonly isPriceOverridden: boolean;
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

  // Backdating is legitimate and necessary — a mess entering students a
  // fortnight after it opened must record when they actually started eating, or
  // every end date is pushed out by that fortnight. But the field was
  // previously unbounded, so a mistyped year could create a plan that ended
  // before it was entered, leaving a paying student unservable with nothing on
  // screen to explain it. `validateSubscriptionStart` bounds it from the plan's
  // own duration, so a longer plan may legitimately be backdated further.
  // What this student buys, and what they pay for it. A student taking 17 days
  // of a 30-day plan pays for 17 — see D-17, which supersedes D-03's per-meal
  // derivation with a per-day one rounded up.
  const assignmentDurationDays = request.assignmentDurationDays ?? plan.durationDays;
  const priced = parseAssignmentPricing({
    actorRole,
    planFinalPricePaise: plan.pricePaise,
    planDurationDays: plan.durationDays,
    assignmentDurationDays,
    ...(request.overrideRupees === undefined ? {} : { overrideRupees: request.overrideRupees }),
  });
  if (!priced.ok) return priced;

  const today = serviceDateOf(request.timeZone, request.now);
  const checked = validateSubscriptionStart({
    startDate: request.startDate ?? today,
    today,
    // The days bought, not the plan's own term. Charging for 17 days and then
    // serving 30 is the bug this line prevents.
    durationDays: assignmentDurationDays,
  });
  if (!checked.ok) return checked;
  const period = checked.value;

  // No two subscriptions may cover the same day. A cancelled or explicitly
  // expired row releases its dates; anything else still holds them, including a
  // term that has simply run out — nothing writes to the status column when
  // time passes, so a finished plan's row still reads ACTIVE.
  const clash = overlappingPeriod(request.existingPeriods ?? [], period.startDate, period.endDate);
  if (clash) {
    const firstFree = addDays(clash.endDate, 1);
    return err(
      domainError(
        "CONFLICT",
        `This student already has a plan covering ${clash.startDate} to ${clash.endDate}. Start the new one on ${firstFree} or later.`,
        { from: clash.startDate, to: clash.endDate, firstFree },
      ),
    );
  }

  // Copied, not referenced: a later mutation of the plan object must not reach
  // back into a subscription that has already been agreed.
  const mealSlotsSnapshot = [...plan.mealSlots];

  // Both halves follow what this student actually got: the price they pay, over
  // the meals they bought. Deriving the credit rate from the full plan instead
  // would refund a discounted student more per skipped meal than they paid.
  const meals = planMealsInPeriod(mealSlotsSnapshot.length, assignmentDurationDays);

  return ok({
    planId: plan.id,
    pricePaiseSnapshot: priced.value.finalPricePaise,
    mealSlotsSnapshot,
    planDurationDaysSnapshot: plan.durationDays,
    assignmentDurationDays,
    calculatedPricePaise: priced.value.calculatedPricePaise,
    isPriceOverridden: priced.value.isOverridden,
    startDate: period.startDate,
    endDate: period.endDate,
    perMealPaise: perMealPaise(priced.value.finalPricePaise, meals),
  });
}

// --- Deleting an upcoming subscription -------------------------------------

export interface DeleteScheduledSubscriptionRequest {
  readonly actorRole: UserRole;
  readonly subscription: SubscriptionDates;
  readonly today: ServiceDate;
  /** PENDING, APPROVED or CREDITED absence requests on this subscription. */
  readonly liveAbsences: number;
  /** Non-cancelled pauses on this subscription. */
  readonly livePauses: number;
}

/**
 * Whether an upcoming subscription may be deleted outright.
 *
 * Only one that has not started. A term that has begun has meals served
 * against it and is a record an owner will be asked about, so it is ended
 * (CANCELLED, audited), never deleted. An upcoming one is usually an early
 * renewal on the wrong plan or dates, and while it exists its dates stay
 * claimed under `subscriptions_no_overlap` — blocking the correction.
 *
 * Refused while anything a student relies on hangs off it. Absence requests
 * and pauses reference the subscription with ON DELETE CASCADE, so deleting
 * the plan would quietly delete them too; the admin clears them first, which
 * is a decision the student can be told about.
 */
export function canDeleteScheduledSubscription(
  request: DeleteScheduledSubscriptionRequest,
): Result<true, DomainError> {
  if (!isAdmin(request.actorRole)) {
    return err(forbidden("Only an admin can delete a meal plan."));
  }

  const state = subscriptionStateOf(request.subscription, request.today);
  if (state === "RUNNING") {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "This plan has already started, so it cannot be deleted. Use End plan instead.",
      ),
    );
  }
  if (state !== "SCHEDULED") {
    return err(
      domainError("VALIDATION_FAILED", "Only a plan that has not started yet can be deleted."),
    );
  }

  if (request.liveAbsences > 0) {
    return err(
      domainError(
        "CONFLICT",
        "The student has an absence request on this plan. Reject or cancel it first, then delete the plan.",
      ),
    );
  }
  if (request.livePauses > 0) {
    return err(
      domainError(
        "CONFLICT",
        "A pause is set on this plan. Cancel the pause first, then delete the plan.",
      ),
    );
  }

  return ok(true);
}
