/**
 * Tests for the plan and subscription policy.
 *
 * Written before the implementation. The money rules here are the ones that
 * become disputes: a price frozen at the wrong moment, or two active plans on
 * one student, are both discovered weeks later at the counter.
 */
import { describe, expect, it } from "vitest";
import { MealSlot, StudentStatus, UserRole } from "@/core/domain/enums";
import { toPaise } from "@/core/money";
import {
  activateSubscription,
  parsePlanDraft,
  planMealsInPeriod,
  type ActivationRequest,
  type PlanDraftInput,
} from "@/core/policies/plan.policy";
import { toServiceDate } from "@/core/time";

const validDraft: PlanDraftInput = {
  actorRole: UserRole.ADMIN,
  name: "Monthly — Lunch & Dinner",
  priceRupees: 4000,
  durationType: "MONTHLY",
  durationDays: 30,
  mealSlots: [MealSlot.LUNCH, MealSlot.DINNER],
  servedSlots: [MealSlot.LUNCH, MealSlot.DINNER],
};

describe("parsePlanDraft — authorization", () => {
  it("allows an admin", () => {
    expect(parsePlanDraft(validDraft).ok).toBe(true);
  });

  it("refuses staff — plan pricing is not a counter decision", () => {
    const r = parsePlanDraft({ ...validDraft, actorRole: UserRole.STAFF });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("parsePlanDraft — money", () => {
  it("converts rupees to integer paise", () => {
    const r = parsePlanDraft(validDraft);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pricePaise).toBe(400000);
  });

  it("keeps paise exact for a price with decimals", () => {
    // 4000.50 * 100 in float is 400049.99999999994; a naive truncation loses a
    // paise on every plan sold.
    const r = parsePlanDraft({ ...validDraft, priceRupees: 4000.5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pricePaise).toBe(400050);
  });

  it("rejects a price with sub-paise precision rather than silently rounding", () => {
    const r = parsePlanDraft({ ...validDraft, priceRupees: 4000.567 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a negative price", () => {
    const r = parsePlanDraft({ ...validDraft, priceRupees: -1 });
    expect(r.ok).toBe(false);
  });

  it("rejects a zero-price plan — reversing an earlier allowance (D-21)", () => {
    // This used to pass, deliberately, so a mess could run a staff or
    // scholarship plan at no charge. Migration 014 replaced
    // `plans_price_nonneg` with `plans_price_positive` because the far more
    // common cause of a zero here is a price nobody filled in, and an unpriced
    // plan silently produces a zero per-meal credit rate for everyone on it.
    //
    // The capability is genuinely gone, not merely validated differently. If a
    // mess needs to feed somebody free, that now has to be a real decision
    // somewhere visible rather than a blank field.
    const r = parsePlanDraft({ ...validDraft, priceRupees: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a price beyond the safe integer range", () => {
    const r = parsePlanDraft({ ...validDraft, priceRupees: Number.MAX_SAFE_INTEGER });
    expect(r.ok).toBe(false);
  });

  it("rejects NaN, which is what an empty number input produces", () => {
    const r = parsePlanDraft({ ...validDraft, priceRupees: Number.NaN });
    expect(r.ok).toBe(false);
  });
});

describe("parsePlanDraft — name, duration and slots", () => {
  it("trims the name", () => {
    const r = parsePlanDraft({ ...validDraft, name: "  Monthly  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe("Monthly");
  });

  it("rejects a blank name — the DB constraint would reject it anyway", () => {
    const r = parsePlanDraft({ ...validDraft, name: "   " });
    expect(r.ok).toBe(false);
  });

  it("rejects zero or negative duration", () => {
    expect(parsePlanDraft({ ...validDraft, durationDays: 0 }).ok).toBe(false);
    expect(parsePlanDraft({ ...validDraft, durationDays: -5 }).ok).toBe(false);
  });

  it("rejects a duration beyond the 400-day column constraint", () => {
    expect(parsePlanDraft({ ...validDraft, durationDays: 401 }).ok).toBe(false);
  });

  it("rejects an empty meal slot list — a plan covering no meals is meaningless", () => {
    const r = parsePlanDraft({ ...validDraft, mealSlots: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("de-duplicates repeated meal slots", () => {
    const r = parsePlanDraft({
      ...validDraft,
      mealSlots: [MealSlot.LUNCH, MealSlot.LUNCH, MealSlot.DINNER],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.mealSlots).toEqual([MealSlot.LUNCH, MealSlot.DINNER]);
  });

  it("orders meal slots by time of day, not by input order", () => {
    // So "Dinner, Lunch" and "Lunch, Dinner" render identically everywhere.
    const r = parsePlanDraft({
      ...validDraft,
      mealSlots: [MealSlot.DINNER, MealSlot.BREAKFAST, MealSlot.LUNCH],
      // This mess serves breakfast too, so the test exercises ordering rather
      // than tripping the "meal not served here" rule.
      servedSlots: [MealSlot.BREAKFAST, MealSlot.LUNCH, MealSlot.DINNER],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mealSlots).toEqual([MealSlot.BREAKFAST, MealSlot.LUNCH, MealSlot.DINNER]);
    }
  });
});

describe("parsePlanDraft — a plan may only include meals the mess serves", () => {
  it("rejects a meal the mess does not serve", () => {
    // The mess serves lunch and dinner. A plan promising breakfast is a promise
    // it cannot keep: the student is told they have breakfast, no breakfast
    // window exists, and they are refused at a counter that never opens.
    const r = parsePlanDraft({
      ...validDraft,
      mealSlots: [MealSlot.BREAKFAST, MealSlot.LUNCH, MealSlot.SNACKS, MealSlot.DINNER],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SLOT_NOT_SERVED");
  });

  it("names the offending meals so the admin knows what to untick", () => {
    const r = parsePlanDraft({
      ...validDraft,
      mealSlots: [MealSlot.BREAKFAST, MealSlot.LUNCH, MealSlot.SNACKS],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message.toLowerCase()).toContain("breakfast");
      expect(r.error.message.toLowerCase()).toContain("snacks");
    }
  });

  it("accepts a plan covering a subset of what the mess serves", () => {
    const r = parsePlanDraft({ ...validDraft, mealSlots: [MealSlot.DINNER] });
    expect(r.ok).toBe(true);
  });

  it("accepts breakfast once the mess actually serves it", () => {
    const r = parsePlanDraft({
      ...validDraft,
      mealSlots: [MealSlot.BREAKFAST, MealSlot.LUNCH],
      servedSlots: [MealSlot.BREAKFAST, MealSlot.LUNCH, MealSlot.DINNER],
    });
    expect(r.ok).toBe(true);
  });

  it("keeps the per-meal rate honest by construction", () => {
    // The rate divides the price by slots x days. Counting a meal that can
    // never be claimed halves the rate, and every mess-cut credit derived from
    // it would be wrong. Refusing the plan is what prevents that.
    const bad = parsePlanDraft({
      ...validDraft,
      priceRupees: 5200,
      mealSlots: [MealSlot.BREAKFAST, MealSlot.LUNCH, MealSlot.SNACKS, MealSlot.DINNER],
    });
    expect(bad.ok).toBe(false);
  });
});

describe("planMealsInPeriod", () => {
  it("multiplies slots by days — the denominator for the per-meal rate", () => {
    expect(planMealsInPeriod(2, 30)).toBe(60);
  });

  it("rejects zero days rather than returning a zero denominator", () => {
    // perMealPaise would throw on a zero denominator; catching it here gives a
    // domain error instead of a crash.
    expect(() => planMealsInPeriod(2, 0)).toThrow();
  });
});

describe("activateSubscription", () => {
  const plan = {
    id: "11111111-1111-4111-8111-111111111111",
    isActive: true,
    pricePaise: toPaise(400000),
    durationDays: 30,
    mealSlots: [MealSlot.LUNCH, MealSlot.DINNER],
  };

  const base: ActivationRequest = {
    actorRole: UserRole.ADMIN,
    studentStatus: StudentStatus.ACTIVE,
    plan,
    timeZone: "Asia/Kolkata",
    now: new Date("2026-07-20T06:00:00Z"),
  };

  it("snapshots the plan's price and slots, not a reference to the plan", () => {
    const r = activateSubscription(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pricePaiseSnapshot).toBe(400000);
      expect(r.value.mealSlotsSnapshot).toEqual([MealSlot.LUNCH, MealSlot.DINNER]);
    }
  });

  it("snapshots a copy, so mutating the plan afterwards cannot alter history", () => {
    const mutable = { ...plan, mealSlots: [MealSlot.LUNCH, MealSlot.DINNER] as MealSlot[] };
    const r = activateSubscription({ ...base, plan: mutable });
    expect(r.ok).toBe(true);
    mutable.mealSlots.push(MealSlot.BREAKFAST);
    if (r.ok) expect(r.value.mealSlotsSnapshot).toEqual([MealSlot.LUNCH, MealSlot.DINNER]);
  });

  it("derives the period in the tenant's timezone", () => {
    const r = activateSubscription({ ...base, now: new Date("2026-07-30T20:00:00Z") });
    expect(r.ok).toBe(true);
    // Already 31 Jul in Kolkata.
    if (r.ok) {
      expect(r.value.startDate).toBe("2026-07-31");
      expect(r.value.endDate).toBe("2026-08-29");
    }
  });

  it("refuses a second subscription covering the same days — it would double-count the headcount", () => {
    // Two plans over one day makes "which plan paid for this meal?"
    // unanswerable and counts the student twice in every headcount. Terms that
    // merely follow one another are fine; see the overlap suite below.
    const r = activateSubscription({
      ...base,
      existingPeriods: [
        {
          status: "ACTIVE",
          startDate: toServiceDate("2026-07-01"),
          endDate: toServiceDate("2026-07-31"),
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CONFLICT");
  });

  it("refuses an inactive plan, which must not be sold to anyone new", () => {
    const r = activateSubscription({ ...base, plan: { ...plan, isActive: false } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a plan for a student who has left", () => {
    const r = activateSubscription({ ...base, studentStatus: StudentStatus.INACTIVE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("STUDENT_INACTIVE");
  });

  it("allows a plan for a blocked student — paying is how they get unblocked", () => {
    const r = activateSubscription({ ...base, studentStatus: StudentStatus.BLOCKED });
    expect(r.ok).toBe(true);
  });

  it("refuses staff", () => {
    const r = activateSubscription({ ...base, actorRole: UserRole.STAFF });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("accepts an explicit start date for a backdated activation", () => {
    const r = activateSubscription({ ...base, startDate: toServiceDate("2026-07-01") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.startDate).toBe("2026-07-01");
      expect(r.value.endDate).toBe("2026-07-30");
    }
  });

  it("reports the per-meal rate, floored so the remainder stays with the mess", () => {
    // 400000 paise / (2 slots * 30 days) = 6666.67 -> 6666
    const r = activateSubscription(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.perMealPaise).toBe(6666);
  });

  it("never lets the per-meal rate times meals exceed what was paid", () => {
    // The invariant behind every future mess-cut credit.
    const r = activateSubscription(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const meals = r.value.mealSlotsSnapshot.length * plan.durationDays;
      expect(r.value.perMealPaise * meals).toBeLessThanOrEqual(r.value.pricePaiseSnapshot);
    }
  });

  it("handles a free plan without dividing by zero", () => {
    const r = activateSubscription({ ...base, plan: { ...plan, pricePaise: toPaise(0) } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.perMealPaise).toBe(0);
  });
});

/**
 * Backdating an activation.
 *
 * The mess ran on paper for a fortnight, so a student being signed up today may
 * have started eating on the 1st. Recording today pushes the end date out by the
 * same fortnight — meals given away, and every report over the backdated period
 * claims they were not subscribed.
 *
 * The date field was already there and already unbounded, which is the other
 * half of the problem: nothing stopped a mistyped year creating a plan that
 * ended before it was entered, leaving a paying student unable to be served
 * with no explanation on screen.
 */
describe("activateSubscription — when the plan starts", () => {
  const NOW = new Date("2026-08-15T06:00:00Z"); // 11:30 IST

  function request(over: Partial<ActivationRequest> = {}): ActivationRequest {
    return {
      actorRole: UserRole.ADMIN,
      studentStatus: StudentStatus.ACTIVE,
      plan: {
        id: "11111111-1111-1111-1111-111111111111",
        isActive: true,
        pricePaise: toPaise(520000),
        durationDays: 30,
        mealSlots: [MealSlot.LUNCH, MealSlot.DINNER],
      },
      timeZone: "Asia/Kolkata",
      now: NOW,
      ...over,
    };
  }

  it("starts today when no date is given", () => {
    const r = activateSubscription(request());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.startDate).toBe("2026-08-15");
  });

  it("uses the tenant's day, not UTC's", () => {
    // 19:00 UTC on the 15th is already the 16th in Kolkata.
    const r = activateSubscription(request({ now: new Date("2026-08-15T19:00:00Z") }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.startDate).toBe("2026-08-16");
  });

  it("accepts the backdate this exists for, and ends 30 days from THEN", () => {
    const r = activateSubscription(request({ startDate: toServiceDate("2026-08-01") }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.startDate).toBe("2026-08-01");
      // Not 2026-09-13, which is what starting today would have produced.
      expect(r.value.endDate).toBe("2026-08-30");
    }
  });

  it("refuses a backdate whose plan would already have ended", () => {
    // A mistyped year, or a date from a previous term. As entered, the student
    // could not be served today — never the intent when assigning a plan.
    const r = activateSubscription(request({ startDate: toServiceDate("2026-01-01") }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("still accepts a backdate whose last day is today", () => {
    const r = activateSubscription(request({ startDate: toServiceDate("2026-07-17") }));
    expect(r.ok).toBe(true);
  });

  it("refuses a start date more than a year ahead", () => {
    const r = activateSubscription(request({ startDate: toServiceDate("2028-01-01") }));
    expect(r.ok).toBe(false);
  });

  it("allows a longer plan to be backdated further", () => {
    // The bound comes from the plan's own duration, not an arbitrary number of
    // days: a 90-day plan started in June still covers today.
    const start = toServiceDate("2026-06-01");
    expect(activateSubscription(request({ startDate: start })).ok).toBe(false);
    const ninety = request({
      startDate: start,
      plan: { ...request().plan, durationDays: 90 },
    });
    expect(activateSubscription(ninety).ok).toBe(true);
  });

  it("checks authorization before the date, so an unauthorized actor learns nothing", () => {
    const r = activateSubscription(
      request({ actorRole: UserRole.STAFF, startDate: toServiceDate("2020-01-01") }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// Pro-rated assignments (D-17, superseding D-03)
//
// Until now a student always bought the plan's full term. These cover buying
// part of one: the price is pro-rated per day and rounded up, the end date
// follows the days actually bought, and an admin may override the figure.
// ---------------------------------------------------------------------------

describe("activateSubscription — partial terms", () => {
  const plan = {
    id: "11111111-1111-4111-8111-111111111111",
    isActive: true,
    pricePaise: toPaise(340000),
    durationDays: 30,
    mealSlots: [MealSlot.LUNCH, MealSlot.DINNER],
  };

  const base: ActivationRequest = {
    actorRole: UserRole.ADMIN,
    studentStatus: StudentStatus.ACTIVE,
    plan,
    timeZone: "Asia/Kolkata",
    now: new Date("2026-07-20T06:00:00Z"),
  };

  it("defaults to the full plan term when no duration is given", () => {
    // The existing behaviour, preserved: every caller that predates pro-rating
    // keeps working and keeps charging the full price.
    const r = activateSubscription(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assignmentDurationDays).toBe(30);
    expect(r.value.pricePaiseSnapshot).toBe(340000);
    expect(r.value.isPriceOverridden).toBe(false);
  });

  it("pro-rates a shorter term and rounds up (spec §6.4)", () => {
    // ₹3,400 over 30 days, taken for 17 → 1926.66… → ₹1,927.
    const r = activateSubscription({ ...base, assignmentDurationDays: 17 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.calculatedPricePaise).toBe(192700);
    expect(r.value.pricePaiseSnapshot).toBe(192700);
  });

  it("ends the plan after the days bought, not the plan's own duration", () => {
    // The bug this guards: charging for 17 days and then serving 30. The end
    // date has to follow what was actually sold.
    const r = activateSubscription({ ...base, assignmentDurationDays: 17 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.startDate).toBe(toServiceDate("2026-07-20"));
    expect(r.value.endDate).toBe(toServiceDate("2026-08-05"));
  });

  it("snapshots the plan's duration alongside the assignment's", () => {
    // Both are needed to explain the price later without touching the plan row,
    // which may since have been edited or retired.
    const r = activateSubscription({ ...base, assignmentDurationDays: 17 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.planDurationDaysSnapshot).toBe(30);
    expect(r.value.assignmentDurationDays).toBe(17);
  });

  it("refuses to sell more days than the plan offers", () => {
    const r = activateSubscription({ ...base, assignmentDurationDays: 45 });
    expect(r.ok).toBe(false);
  });

  it("keeps an admin's override and records what the formula said", () => {
    const r = activateSubscription({
      ...base,
      assignmentDurationDays: 17,
      overrideRupees: 1900,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.calculatedPricePaise).toBe(192700);
    expect(r.value.pricePaiseSnapshot).toBe(190000);
    expect(r.value.isPriceOverridden).toBe(true);
  });

  it("derives the per-meal credit rate from what the student actually pays", () => {
    // The rate mess-cut credits are issued at. It must follow the discounted
    // price and the days actually bought — crediting a student at the full
    // plan's rate for a term they got at half price would refund more than
    // they paid, which is the invariant money.ts exists to protect.
    const r = activateSubscription({
      ...base,
      assignmentDurationDays: 17,
      overrideRupees: 1700,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // ₹1,700 over 17 days × 2 meals = 34 meals → ₹50 a meal exactly.
    expect(r.value.perMealPaise).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Renewal, and the overlap rule that replaced "one active subscription"
//
// The old rule was a partial unique index: one row with status ACTIVE per
// student. That is not the domain rule, it is a proxy for it, and it made the
// commonest renewal impossible — a student paying on the 25th for a term that
// starts on the 1st needs two subscriptions to exist at once.
//
// The real rule is that no two subscriptions may cover the same DAY.
// Consecutive terms are exactly what renewal is.
// ---------------------------------------------------------------------------

describe("activateSubscription — overlap with an existing subscription", () => {
  const plan = {
    id: "11111111-1111-4111-8111-111111111111",
    isActive: true,
    pricePaise: toPaise(360000),
    durationDays: 30,
    mealSlots: [MealSlot.LUNCH, MealSlot.DINNER],
  };

  const base: ActivationRequest = {
    actorRole: UserRole.ADMIN,
    studentStatus: StudentStatus.ACTIVE,
    plan,
    timeZone: "Asia/Kolkata",
    // 6 Sep 2026, 11:30 IST.
    now: new Date("2026-09-06T06:00:00Z"),
  };

  /** A term running 1–30 September, as stored: the column still says ACTIVE. */
  const currentTerm = {
    status: "ACTIVE",
    startDate: toServiceDate("2026-09-01"),
    endDate: toServiceDate("2026-09-30"),
  };

  it("refuses a renewal that starts while the current term is still running", () => {
    // The case the owner asked to reject rather than silently truncate: the
    // student has 24 paid days left and must not lose them.
    const r = activateSubscription({
      ...base,
      existingPeriods: [currentTerm],
      startDate: toServiceDate("2026-09-06"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CONFLICT");
  });

  it("names the first date they CAN renew from", () => {
    // An error that says "no" is a support call; one that says "1 Oct" is not.
    const r = activateSubscription({
      ...base,
      existingPeriods: [currentTerm],
      startDate: toServiceDate("2026-09-06"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("2026-10-01");
  });

  it("accepts a renewal starting the day after the current term ends", () => {
    // The whole point: two subscriptions coexist, back to back, neither touched.
    const r = activateSubscription({
      ...base,
      existingPeriods: [currentTerm],
      startDate: toServiceDate("2026-10-01"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.startDate).toBe(toServiceDate("2026-10-01"));
    expect(r.value.endDate).toBe(toServiceDate("2026-10-30"));
  });

  it("accepts a renewal after a term that has already finished", () => {
    const finished = {
      status: "ACTIVE",
      startDate: toServiceDate("2026-07-01"),
      endDate: toServiceDate("2026-07-30"),
    };
    const r = activateSubscription({
      ...base,
      existingPeriods: [finished],
      startDate: toServiceDate("2026-09-06"),
    });
    expect(r.ok).toBe(true);
  });

  it("refuses a renewal that would overlap a finished term's own dates", () => {
    // Backdating onto days another subscription already covered would
    // double-count the student in revenue and make "which plan paid for this
    // meal?" unanswerable. A finished plan's column still reads ACTIVE, so it
    // still holds its dates.
    const finished = {
      status: "ACTIVE",
      startDate: toServiceDate("2026-07-01"),
      endDate: toServiceDate("2026-07-30"),
    };
    const r = activateSubscription({
      ...base,
      existingPeriods: [finished],
      startDate: toServiceDate("2026-07-15"),
    });
    expect(r.ok).toBe(false);
  });

  it("ignores a cancelled subscription — cancelling frees its dates", () => {
    const cancelled = { ...currentTerm, status: "CANCELLED" };
    const r = activateSubscription({
      ...base,
      existingPeriods: [cancelled],
      startDate: toServiceDate("2026-09-06"),
    });
    expect(r.ok).toBe(true);
  });

  it("ignores one explicitly marked EXPIRED — the deliberate escape hatch", () => {
    const expired = { ...currentTerm, status: "EXPIRED" };
    const r = activateSubscription({
      ...base,
      existingPeriods: [expired],
      startDate: toServiceDate("2026-09-06"),
    });
    expect(r.ok).toBe(true);
  });

  it("checks every existing period, not just the first", () => {
    const r = activateSubscription({
      ...base,
      existingPeriods: [
        {
          status: "ACTIVE",
          startDate: toServiceDate("2026-07-01"),
          endDate: toServiceDate("2026-07-30"),
        },
        currentTerm,
      ],
      startDate: toServiceDate("2026-09-15"),
    });
    expect(r.ok).toBe(false);
  });

  it("catches an overlap at the far end, not only the start", () => {
    // A 30-day term starting 20 Sep ends 19 Oct; its first ten days collide
    // with a term ending 30 Sep even though its start date does not.
    const r = activateSubscription({
      ...base,
      existingPeriods: [currentTerm],
      startDate: toServiceDate("2026-09-20"),
    });
    expect(r.ok).toBe(false);
  });

  it("treats no existing subscriptions as no obstacle", () => {
    const r = activateSubscription({ ...base, existingPeriods: [] });
    expect(r.ok).toBe(true);
  });
});
