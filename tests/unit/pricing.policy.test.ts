/**
 * The three-layer pricing engine (meal price → plan price → assignment price).
 *
 * The one rule the whole feature turns on: **never recompute historical pricing
 * from current rates**. Each layer freezes what it needs at the moment it is
 * created. Raising the price of dinner in November must not change a plan sold
 * in September, and editing that plan must not change what a student already
 * agreed to pay for it.
 *
 * The arithmetic is done entirely in integer paise. The source spec suggested
 * `Math.ceil(rawPrice - 1e-9)` on floats, with the epsilon there to absorb
 * results like 59.999999999. That epsilon is a symptom: in paise the same
 * calculation is exact integer division and there is nothing to absorb. The
 * float tests at the bottom exist to keep it that way.
 */
import { describe, expect, it } from "vitest";
import {
  assignmentPricePaise,
  autoBasePremiumPaise,
  parseAssignmentPricing,
  parseMealPrice,
  parsePlanPricing,
  type AssignmentPricingInput,
} from "@/core/policies/pricing.policy";
import { toPaise } from "@/core/money";

const rupees = (n: number) => toPaise(n * 100);

// ---------------------------------------------------------------------------
// Layer 1 — meal prices
// ---------------------------------------------------------------------------

describe("parseMealPrice", () => {
  it("accepts a positive rupee amount from an admin", () => {
    const result = parseMealPrice({ actorRole: "ADMIN", mealSlot: "LUNCH", priceRupees: 60 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.pricePaise).toBe(6000);
  });

  it("rejects zero — an unpriced meal is a misconfiguration, not a free meal", () => {
    const result = parseMealPrice({ actorRole: "ADMIN", mealSlot: "LUNCH", priceRupees: 0 });
    expect(result.ok).toBe(false);
  });

  it("rejects a negative price", () => {
    const result = parseMealPrice({ actorRole: "ADMIN", mealSlot: "LUNCH", priceRupees: -5 });
    expect(result.ok).toBe(false);
  });

  it("rejects sub-paise precision rather than silently rounding it", () => {
    // Matches how parsePlanDraft already treats prices: an admin who typed
    // 60.567 meant something, and choosing 60.57 for them is not our decision.
    const result = parseMealPrice({ actorRole: "ADMIN", mealSlot: "LUNCH", priceRupees: 60.567 });
    expect(result.ok).toBe(false);
  });

  it("refuses staff", () => {
    const result = parseMealPrice({ actorRole: "STAFF", mealSlot: "LUNCH", priceRupees: 60 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — plan pricing
// ---------------------------------------------------------------------------

describe("autoBasePremiumPaise", () => {
  it("multiplies the summed meal rates by the duration (spec §5.3)", () => {
    // The spec's worked example: lunch ₹60 + dinner ₹60 over 30 days = ₹3,600.
    const total = autoBasePremiumPaise(
      { LUNCH: rupees(60), DINNER: rupees(60) },
      ["LUNCH", "DINNER"],
      30,
    );
    expect(total).toBe(360000);
  });

  it("counts only the selected meals", () => {
    const total = autoBasePremiumPaise(
      { BREAKFAST: rupees(30), LUNCH: rupees(60), DINNER: rupees(60) },
      ["LUNCH"],
      30,
    );
    expect(total).toBe(180000);
  });

  it("treats an unpriced meal as zero rather than throwing", () => {
    // A mess that has not set a snacks price yet must still be able to build a
    // plan; the admin sees a lower suggestion and edits it. Refusing outright
    // would block plan creation on unrelated configuration.
    const total = autoBasePremiumPaise({ LUNCH: rupees(60) }, ["LUNCH", "SNACKS"], 10);
    expect(total).toBe(60000);
  });
});

describe("parsePlanPricing", () => {
  const base = {
    actorRole: "ADMIN" as const,
    basePremiumRupees: 3800,
    discountRupees: 200,
  };

  it("freezes base, discount and the final price (spec §5.3)", () => {
    const result = parsePlanPricing(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.basePremiumPaise).toBe(380000);
    expect(result.value.discountPaise).toBe(20000);
    expect(result.value.finalPricePaise).toBe(360000);
  });

  it("allows a zero discount", () => {
    const result = parsePlanPricing({ ...base, discountRupees: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.finalPricePaise).toBe(380000);
  });

  it("rejects a discount equal to the base — final price would be zero (§9)", () => {
    const result = parsePlanPricing({ ...base, discountRupees: 3800 });
    expect(result.ok).toBe(false);
  });

  it("rejects a discount larger than the base (§9)", () => {
    const result = parsePlanPricing({ ...base, discountRupees: 4000 });
    expect(result.ok).toBe(false);
  });

  it("rejects a negative discount", () => {
    const result = parsePlanPricing({ ...base, discountRupees: -100 });
    expect(result.ok).toBe(false);
  });

  it("rejects a base premium of zero", () => {
    const result = parsePlanPricing({ ...base, basePremiumRupees: 0, discountRupees: 0 });
    expect(result.ok).toBe(false);
  });

  it("refuses staff", () => {
    const result = parsePlanPricing({ ...base, actorRole: "STAFF" });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — assignment pricing (D-17, superseding D-03)
// ---------------------------------------------------------------------------

describe("assignmentPricePaise", () => {
  it("pro-rates and rounds up to the whole rupee (spec §6.4)", () => {
    // The spec's worked example: ₹3,400 over 30 days, taken for 17.
    // 3400 ÷ 30 × 17 = 1926.66… → ₹1,927.
    expect(assignmentPricePaise(rupees(3400), 30, 17)).toBe(rupees(1927));
  });

  it("returns the plan price exactly when the durations match (§9)", () => {
    // Explicitly required by the spec: "no rounding artifact, since duration
    // ratio = 1". Special-cased rather than trusted to fall out, because a plan
    // priced at ₹3,400.50 would otherwise round up to ₹3,401 for a student
    // taking the full term.
    expect(assignmentPricePaise(rupees(3400), 30, 30)).toBe(rupees(3400));
    expect(assignmentPricePaise(toPaise(340050), 30, 30)).toBe(toPaise(340050));
  });

  it("handles a single day", () => {
    // 3400 ÷ 30 = 113.33… → ₹114.
    expect(assignmentPricePaise(rupees(3400), 30, 1)).toBe(rupees(114));
  });

  it("leaves an exact division alone (§9)", () => {
    // 3600 ÷ 30 × 10 = 1200 exactly; rounding up must not add a rupee.
    expect(assignmentPricePaise(rupees(3600), 30, 10)).toBe(rupees(1200));
  });

  it("rounds up, never to nearest — the remainder stays with the mess", () => {
    // 100 ÷ 3 = 33.33… → ₹34, not ₹33. Consistent with the direction
    // perMealPaise already floors credits in: the mess never loses on rounding.
    expect(assignmentPricePaise(rupees(100), 3, 1)).toBe(rupees(34));
  });

  it("is exact where floating point would not be", () => {
    // 0.1 + 0.2 territory. A float implementation of 5999.99 ÷ 7 × 7 drifts;
    // integer division cannot. This is the case the spec's 1e-9 epsilon was
    // written to paper over.
    expect(assignmentPricePaise(toPaise(599999), 7, 7)).toBe(toPaise(599999));
    expect(assignmentPricePaise(toPaise(599999), 7, 3)).toBe(rupees(2572));
  });
});

describe("parseAssignmentPricing", () => {
  const input = (over: Partial<AssignmentPricingInput> = {}): AssignmentPricingInput => ({
    actorRole: "ADMIN",
    planFinalPricePaise: rupees(3400),
    planDurationDays: 30,
    assignmentDurationDays: 17,
    ...over,
  });

  it("computes the price and marks it not overridden", () => {
    const result = parseAssignmentPricing(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.calculatedPricePaise).toBe(rupees(1927));
    expect(result.value.finalPricePaise).toBe(rupees(1927));
    expect(result.value.isOverridden).toBe(false);
  });

  it("keeps an admin override and flags it (§6.4)", () => {
    const result = parseAssignmentPricing(input({ overrideRupees: 1900 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both are kept: the calculated figure is the record of what the system
    // would have charged, which is the only way to see that a discount happened.
    expect(result.value.calculatedPricePaise).toBe(rupees(1927));
    expect(result.value.finalPricePaise).toBe(rupees(1900));
    expect(result.value.isOverridden).toBe(true);
  });

  it("does not flag an override that matches the calculated price (§9)", () => {
    // The spec leaves this to implementation preference and asks for one
    // convention applied consistently. Ours: overridden means the number
    // actually differs, so the flag always answers "was this student charged
    // something other than the formula?"
    const result = parseAssignmentPricing(input({ overrideRupees: 1927 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.isOverridden).toBe(false);
  });

  it("rejects a duration longer than the plan (§6.5)", () => {
    const result = parseAssignmentPricing(input({ assignmentDurationDays: 31 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a zero or negative duration", () => {
    expect(parseAssignmentPricing(input({ assignmentDurationDays: 0 })).ok).toBe(false);
    expect(parseAssignmentPricing(input({ assignmentDurationDays: -3 })).ok).toBe(false);
  });

  it("rejects a fractional duration", () => {
    expect(parseAssignmentPricing(input({ assignmentDurationDays: 17.5 })).ok).toBe(false);
  });

  it("rejects an override below one rupee (§6.5)", () => {
    // A ₹0 charge is almost certainly a slip. If a mess genuinely wants to feed
    // somebody free, that is a decision worth making explicitly rather than by
    // leaving a field blank.
    expect(parseAssignmentPricing(input({ overrideRupees: 0 })).ok).toBe(false);
    expect(parseAssignmentPricing(input({ overrideRupees: -100 })).ok).toBe(false);
  });

  it("rejects an override with paise — assignments are whole rupees (§6.5)", () => {
    expect(parseAssignmentPricing(input({ overrideRupees: 1900.5 })).ok).toBe(false);
  });

  it("refuses staff", () => {
    const result = parseAssignmentPricing(input({ actorRole: "STAFF" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// The independence rule (spec §7) — the reason the snapshots exist
// ---------------------------------------------------------------------------

describe("layers are independent", () => {
  it("an assignment is priced from the plan's frozen price, not from meal rates", () => {
    // Meal prices double. The plan's frozen final price is what the assignment
    // is computed from, so the student's price is unchanged. This is the whole
    // architectural claim of the feature, stated as a test.
    const frozenPlanPrice = rupees(3600);
    const before = assignmentPricePaise(frozenPlanPrice, 30, 15);

    autoBasePremiumPaise({ LUNCH: rupees(120), DINNER: rupees(120) }, ["LUNCH", "DINNER"], 30);

    const after = assignmentPricePaise(frozenPlanPrice, 30, 15);
    expect(after).toBe(before);
    expect(after).toBe(rupees(1800));
  });

  it("one student's override cannot reach another's price", () => {
    const a = parseAssignmentPricing({
      actorRole: "ADMIN",
      planFinalPricePaise: rupees(3400),
      planDurationDays: 30,
      assignmentDurationDays: 17,
      overrideRupees: 1000,
    });
    const b = parseAssignmentPricing({
      actorRole: "ADMIN",
      planFinalPricePaise: rupees(3400),
      planDurationDays: 30,
      assignmentDurationDays: 17,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.finalPricePaise).toBe(rupees(1000));
    expect(b.value.finalPricePaise).toBe(rupees(1927));
  });
});
