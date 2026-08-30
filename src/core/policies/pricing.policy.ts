/**
 * The pricing engine: meal price → plan price → assignment price.
 *
 * Three layers, each freezing what it needs at the moment it is created:
 *
 *   `meal_prices`   the current rate card. Changing it affects only plans
 *                   created afterwards.
 *   `plans`         base premium, discount and final price, frozen at creation.
 *                   Changing a meal price never reaches back into one.
 *   `subscriptions` the plan's final price and duration, copied at assignment,
 *                   plus what this student was actually charged.
 *
 * Nothing is ever recomputed from a live parent. That is not a performance
 * choice — it is the difference between "this student agreed to ₹3,600" being a
 * fact and being a query whose answer changes when the owner raises next term's
 * rates.
 *
 * ## Everything here is integer paise
 *
 * The source spec suggested `Math.ceil(rawPrice - 1e-9)`, with the epsilon
 * guarding against float results like 59.999999999. The epsilon is a symptom of
 * working in float rupees. In paise the same calculation is exact integer
 * division and there is nothing to guard against, so there is no epsilon here
 * and there must never be one.
 */
import type { MealSlot, UserRole } from "@/core/domain/enums";
import { domainError, forbidden, type DomainError } from "@/core/errors";
import { rupeesToPaise, toPaise, type Paise } from "@/core/money";
import { err, ok, type Result } from "@/core/result";

/** Matches the 1–400 day CHECK on `plans.duration_days`. */
const MAX_DURATION_DAYS = 400;

/** Guards a mistyped extra zero from becoming a ₹5,00,000 meal. */
const MAX_MEAL_PRICE_PAISE = 10_000_00;

function isAdmin(role: UserRole): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/**
 * Converts an admin's rupee input, refusing sub-paise precision.
 *
 * Shared by all three layers so "4000.567" is rejected identically wherever it
 * is typed. Rounding it away would be choosing an amount on the admin's behalf.
 */
function parseRupees(rupees: number, label: string): Result<Paise, DomainError> {
  if (!Number.isFinite(rupees)) {
    return err(domainError("VALIDATION_FAILED", `Enter a valid ${label}.`));
  }
  const exact = rupees * 100;
  if (Math.abs(exact - Math.round(exact)) > 1e-6) {
    return err(domainError("VALIDATION_FAILED", `A ${label} cannot be finer than one paise.`));
  }
  try {
    return ok(rupeesToPaise(rupees));
  } catch {
    return err(domainError("VALIDATION_FAILED", `That ${label} is too large.`));
  }
}

// ---------------------------------------------------------------------------
// Layer 1 — meal prices
// ---------------------------------------------------------------------------

export interface MealPriceInput {
  readonly actorRole: UserRole;
  readonly mealSlot: MealSlot;
  readonly priceRupees: number;
}

export interface MealPriceDraft {
  readonly mealSlot: MealSlot;
  readonly pricePaise: Paise;
}

export function parseMealPrice(input: MealPriceInput): Result<MealPriceDraft, DomainError> {
  if (!isAdmin(input.actorRole)) {
    return err(forbidden("Only an admin can set meal prices."));
  }

  const parsed = parseRupees(input.priceRupees, "price");
  if (!parsed.ok) return parsed;

  // Zero is rejected rather than treated as "free". A meal with no price is a
  // mess that has not finished configuring itself, and letting it through would
  // silently produce plans priced below what the food costs.
  if (parsed.value <= 0) {
    return err(domainError("VALIDATION_FAILED", "A meal price must be more than zero."));
  }
  if (parsed.value > MAX_MEAL_PRICE_PAISE) {
    return err(domainError("VALIDATION_FAILED", "That price looks too high — check the amount."));
  }

  return ok({ mealSlot: input.mealSlot, pricePaise: parsed.value });
}

/** The current rate card, as `{ LUNCH: 6000, DINNER: 6000 }`. */
export type MealPriceCard = Partial<Record<MealSlot, Paise>>;

/**
 * The suggested plan price: summed meal rates × duration (spec §5.2).
 *
 * Only a suggestion — the admin may edit it before saving, and whatever they
 * save is what freezes. A meal with no rate contributes nothing rather than
 * throwing, so a mess that has not priced snacks yet can still build a plan;
 * the admin sees a low number and corrects it.
 */
export function autoBasePremiumPaise(
  card: MealPriceCard,
  slots: readonly MealSlot[],
  durationDays: number,
): Paise {
  const perDay = slots.reduce<number>((sum, slot) => sum + (card[slot] ?? 0), 0);
  return toPaise(perDay * durationDays);
}

// ---------------------------------------------------------------------------
// Layer 2 — plan pricing
// ---------------------------------------------------------------------------

export interface PlanPricingInput {
  readonly actorRole: UserRole;
  /** Pre-filled from `autoBasePremiumPaise`, then editable (§5.2 step 4). */
  readonly basePremiumRupees: number;
  readonly discountRupees: number;
}

export interface PlanPricing {
  readonly basePremiumPaise: Paise;
  readonly discountPaise: Paise;
  /** `base − discount`. Stored as the plan's authoritative price. */
  readonly finalPricePaise: Paise;
}

export function parsePlanPricing(input: PlanPricingInput): Result<PlanPricing, DomainError> {
  if (!isAdmin(input.actorRole)) {
    return err(forbidden("Only an admin can price a plan."));
  }

  const base = parseRupees(input.basePremiumRupees, "base premium");
  if (!base.ok) return base;
  const discount = parseRupees(input.discountRupees, "discount");
  if (!discount.ok) return discount;

  if (base.value <= 0) {
    return err(domainError("VALIDATION_FAILED", "The base premium must be more than zero."));
  }
  if (discount.value < 0) {
    return err(domainError("VALIDATION_FAILED", "A discount cannot be negative."));
  }

  const finalPricePaise = toPaise(base.value - discount.value);

  // §5.4 and §9: a free plan is almost always a mistyped discount, and it would
  // make every downstream per-meal rate zero.
  if (finalPricePaise <= 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "The discount cannot be as large as the base premium — the plan would be free.",
      ),
    );
  }

  return ok({
    basePremiumPaise: base.value,
    discountPaise: discount.value,
    finalPricePaise,
  });
}

// ---------------------------------------------------------------------------
// Layer 3 — assignment pricing (D-17, superseding D-03)
// ---------------------------------------------------------------------------

/**
 * What a student pays for `assignmentDurationDays` of a plan.
 *
 *     ceil( planFinalPrice ÷ planDuration × assignmentDuration )   to whole ₹1
 *
 * Done as exact integer arithmetic. `ceil(a / b)` for positive integers is
 * `floor((a + b - 1) / b)`, which needs no division in floating point and so
 * cannot drift.
 *
 * Rounding **up**, deliberately, and in the same direction as `perMealPaise`
 * floors credits: the rounding remainder always stays with the mess, so no
 * arithmetic here can quietly cost the owner money.
 */
export function assignmentPricePaise(
  planFinalPricePaise: Paise,
  planDurationDays: number,
  assignmentDurationDays: number,
): Paise {
  if (!Number.isInteger(planDurationDays) || planDurationDays < 1) {
    throw new RangeError(`planDurationDays must be a positive integer, got ${planDurationDays}`);
  }
  if (!Number.isInteger(assignmentDurationDays) || assignmentDurationDays < 1) {
    throw new RangeError(
      `assignmentDurationDays must be a positive integer, got ${assignmentDurationDays}`,
    );
  }

  // §9 requires that a full-term assignment costs exactly the plan price.
  // Special-cased rather than left to the formula: a plan priced at ₹3,400.50
  // would otherwise round up to ₹3,401 for a student taking the whole term,
  // which reads as a bug to everyone who sees it.
  if (assignmentDurationDays === planDurationDays) return planFinalPricePaise;

  // Whole rupees, so the divisor carries the ×100.
  const numerator = planFinalPricePaise * assignmentDurationDays;
  const divisor = planDurationDays * 100;
  const wholeRupees = Math.floor((numerator + divisor - 1) / divisor);
  return toPaise(wholeRupees * 100);
}

export interface AssignmentPricingInput {
  readonly actorRole: UserRole;
  /** The plan's frozen final price — never a live lookup (§7). */
  readonly planFinalPricePaise: Paise;
  readonly planDurationDays: number;
  readonly assignmentDurationDays: number;
  /** Set only when the admin typed their own figure. */
  readonly overrideRupees?: number;
}

export interface AssignmentPricing {
  /** What the formula produced. Stored even when overridden (§6.2 step 5). */
  readonly calculatedPricePaise: Paise;
  /** What the student is actually charged. */
  readonly finalPricePaise: Paise;
  readonly isOverridden: boolean;
}

export function parseAssignmentPricing(
  input: AssignmentPricingInput,
): Result<AssignmentPricing, DomainError> {
  if (!isAdmin(input.actorRole)) {
    return err(forbidden("Only an admin can price a student's plan."));
  }

  const { planDurationDays, assignmentDurationDays } = input;

  if (!Number.isInteger(planDurationDays) || planDurationDays < 1) {
    return err(domainError("VALIDATION_FAILED", "That plan has no usable duration."));
  }
  if (!Number.isInteger(assignmentDurationDays) || assignmentDurationDays < 1) {
    return err(domainError("VALIDATION_FAILED", "Enter a whole number of days, at least one."));
  }
  if (assignmentDurationDays > MAX_DURATION_DAYS) {
    return err(
      domainError("VALIDATION_FAILED", `The duration cannot exceed ${MAX_DURATION_DAYS} days.`),
    );
  }
  // §6.2: a student cannot be sold more days than the plan offers. Selling two
  // terms is two assignments, each with its own frozen price.
  if (assignmentDurationDays > planDurationDays) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `This plan runs for ${planDurationDays} days. Assign a shorter period, or choose a longer plan.`,
        { planDurationDays, assignmentDurationDays },
      ),
    );
  }

  const calculatedPricePaise = assignmentPricePaise(
    input.planFinalPricePaise,
    planDurationDays,
    assignmentDurationDays,
  );

  if (input.overrideRupees === undefined) {
    return ok({ calculatedPricePaise, finalPricePaise: calculatedPricePaise, isOverridden: false });
  }

  const override = parseRupees(input.overrideRupees, "price");
  if (!override.ok) return override;

  // §6.5: assignment prices are whole rupees. A ₹1,900.50 charge cannot be
  // collected in cash at the counter anyway.
  if (override.value % 100 !== 0) {
    return err(domainError("VALIDATION_FAILED", "Enter a whole rupee amount."));
  }
  if (override.value < 100) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "The price must be at least ₹1. Leave it blank to use the calculated price.",
      ),
    );
  }

  return ok({
    calculatedPricePaise,
    finalPricePaise: override.value,
    // "Overridden" means the number actually differs — so the flag always
    // answers "was this student charged something other than the formula?"
    // rather than "did somebody click in the field?".
    isOverridden: override.value !== calculatedPricePaise,
  });
}
