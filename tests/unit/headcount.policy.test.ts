import { describe, it, expect } from "vitest";
import {
  calculateVariance,
  isCutFromMeal,
  isEligibleForMeal,
  projectHeadcount,
  type MessCutSnapshot,
  type SubscriberSnapshot,
} from "@/core/policies/headcount.policy";
import { toServiceDate, type ServiceDate } from "@/core/time";

const d = (s: string): ServiceDate => toServiceDate(s);
const TODAY = d("2026-07-15");

const subscriber = (over: Partial<SubscriberSnapshot> = {}): SubscriberSnapshot => ({
  studentId: "s1",
  studentStatus: "ACTIVE",
  subscriptionStatus: "ACTIVE",
  startDate: d("2026-07-01"),
  endDate: d("2026-07-31"),
  includedMealSlots: ["LUNCH", "DINNER"],
  ...over,
});

const cut = (over: Partial<MessCutSnapshot> = {}): MessCutSnapshot => ({
  studentId: "s1",
  dateFrom: TODAY,
  dateTo: TODAY,
  mealSlots: ["LUNCH", "DINNER"],
  status: "APPROVED",
  ...over,
});

describe("isEligibleForMeal", () => {
  it("counts an active student on an active subscription", () => {
    expect(isEligibleForMeal(subscriber(), TODAY, "LUNCH")).toBe(true);
  });

  it("excludes a BLOCKED student — they cannot generate a QR, so cooking is waste", () => {
    expect(isEligibleForMeal(subscriber({ studentStatus: "BLOCKED" }), TODAY, "LUNCH")).toBe(false);
  });

  it("still counts a GRACE student — they are inside the grace period and will eat", () => {
    expect(isEligibleForMeal(subscriber({ studentStatus: "GRACE" }), TODAY, "LUNCH")).toBe(true);
  });

  it("excludes an INACTIVE student", () => {
    expect(isEligibleForMeal(subscriber({ studentStatus: "INACTIVE" }), TODAY, "LUNCH")).toBe(
      false,
    );
  });

  it.each(["PENDING_PAYMENT", "EXPIRED", "CANCELLED"] as const)(
    "excludes a %s subscription",
    (status) => {
      expect(isEligibleForMeal(subscriber({ subscriptionStatus: status }), TODAY, "LUNCH")).toBe(
        false,
      );
    },
  );

  it("excludes dates outside the subscription term, inclusive at both ends", () => {
    const s = subscriber({ startDate: d("2026-07-10"), endDate: d("2026-07-20") });
    expect(isEligibleForMeal(s, d("2026-07-09"), "LUNCH")).toBe(false);
    expect(isEligibleForMeal(s, d("2026-07-10"), "LUNCH")).toBe(true);
    expect(isEligibleForMeal(s, d("2026-07-20"), "LUNCH")).toBe(true);
    expect(isEligibleForMeal(s, d("2026-07-21"), "LUNCH")).toBe(false);
  });

  it("respects the snapshotted slots, not the plan's current ones", () => {
    const lunchOnly = subscriber({ includedMealSlots: ["LUNCH"] });
    expect(isEligibleForMeal(lunchOnly, TODAY, "LUNCH")).toBe(true);
    expect(isEligibleForMeal(lunchOnly, TODAY, "DINNER")).toBe(false);
  });
});

describe("isCutFromMeal", () => {
  it("honours APPROVED and CREDITED cuts only", () => {
    expect(isCutFromMeal(cut({ status: "APPROVED" }), TODAY, "LUNCH")).toBe(true);
    expect(isCutFromMeal(cut({ status: "CREDITED" }), TODAY, "LUNCH")).toBe(true);
    expect(isCutFromMeal(cut({ status: "REJECTED" }), TODAY, "LUNCH")).toBe(false);
    expect(isCutFromMeal(cut({ status: "CANCELLED" }), TODAY, "LUNCH")).toBe(false);
  });

  it("applies per slot, so a lunch-only cut leaves dinner counted", () => {
    const lunchOnly = cut({ mealSlots: ["LUNCH"] });
    expect(isCutFromMeal(lunchOnly, TODAY, "LUNCH")).toBe(true);
    expect(isCutFromMeal(lunchOnly, TODAY, "DINNER")).toBe(false);
  });

  it("covers a multi-day range inclusively", () => {
    const range = cut({ dateFrom: d("2026-07-14"), dateTo: d("2026-07-16") });
    expect(isCutFromMeal(range, d("2026-07-13"), "LUNCH")).toBe(false);
    expect(isCutFromMeal(range, d("2026-07-14"), "LUNCH")).toBe(true);
    expect(isCutFromMeal(range, d("2026-07-16"), "LUNCH")).toBe(true);
    expect(isCutFromMeal(range, d("2026-07-17"), "LUNCH")).toBe(false);
  });
});

describe("projectHeadcount", () => {
  it("computes the formula from §8 with an auditable breakdown", () => {
    const subscribers = Array.from({ length: 430 }, (_, i) => subscriber({ studentId: `s${i}` }));
    const cuts = Array.from({ length: 22 }, (_, i) => cut({ studentId: `s${i}` }));

    const result = projectHeadcount({
      serviceDate: TODAY,
      mealSlot: "LUNCH",
      subscribers,
      messCuts: cuts,
      guestTokens: 4,
      extraPlates: 2,
    });

    expect(result.projectedCount).toBe(430 - 22 + 4 + 2);
    expect(result.breakdown).toEqual({
      eligibleSubscribers: 430,
      onMessCut: 22,
      guestTokens: 4,
      extraPlates: 2,
    });
  });

  it("defaults guests and extras to zero", () => {
    const result = projectHeadcount({
      serviceDate: TODAY,
      mealSlot: "LUNCH",
      subscribers: [subscriber()],
      messCuts: [],
    });
    expect(result.projectedCount).toBe(1);
    expect(result.guestCount).toBe(0);
    expect(result.extraPlateCount).toBe(0);
  });

  it("never double-counts a student with duplicate subscription rows", () => {
    const result = projectHeadcount({
      serviceDate: TODAY,
      mealSlot: "LUNCH",
      subscribers: [subscriber({ studentId: "s1" }), subscriber({ studentId: "s1" })],
      messCuts: [],
    });
    expect(result.projectedCount).toBe(1);
  });

  it("does not subtract a cut by a student who was never counted", () => {
    // A BLOCKED student with an approved cut must not push the count below the
    // real number of plates needed.
    const result = projectHeadcount({
      serviceDate: TODAY,
      mealSlot: "LUNCH",
      subscribers: [
        subscriber({ studentId: "active" }),
        subscriber({ studentId: "blocked", studentStatus: "BLOCKED" }),
      ],
      messCuts: [cut({ studentId: "blocked" })],
    });
    expect(result.projectedCount).toBe(1);
    expect(result.breakdown.onMessCut).toBe(0);
  });

  it("counts a duplicated cut for the same student once", () => {
    const result = projectHeadcount({
      serviceDate: TODAY,
      mealSlot: "LUNCH",
      subscribers: [subscriber({ studentId: "s1" }), subscriber({ studentId: "s2" })],
      messCuts: [cut({ studentId: "s1" }), cut({ studentId: "s1" })],
    });
    expect(result.projectedCount).toBe(1);
    expect(result.breakdown.onMessCut).toBe(1);
  });

  it("separates lunch and dinner correctly", () => {
    const subscribers = [
      subscriber({ studentId: "both" }),
      subscriber({ studentId: "lunchOnly", includedMealSlots: ["LUNCH"] }),
    ];
    const cuts = [cut({ studentId: "both", mealSlots: ["DINNER"] })];

    const lunch = projectHeadcount({
      serviceDate: TODAY,
      mealSlot: "LUNCH",
      subscribers,
      messCuts: cuts,
    });
    const dinner = projectHeadcount({
      serviceDate: TODAY,
      mealSlot: "DINNER",
      subscribers,
      messCuts: cuts,
    });

    expect(lunch.projectedCount).toBe(2); // both + lunchOnly
    expect(dinner.projectedCount).toBe(0); // 'both' cut dinner, lunchOnly excluded
  });

  it("floors at zero rather than returning a negative plate count", () => {
    const result = projectHeadcount({
      serviceDate: TODAY,
      mealSlot: "LUNCH",
      subscribers: [subscriber({ studentId: "s1" })],
      messCuts: [cut({ studentId: "s1" })],
    });
    expect(result.projectedCount).toBe(0);
  });

  it("ignores negative guest or extra counts", () => {
    const result = projectHeadcount({
      serviceDate: TODAY,
      mealSlot: "LUNCH",
      subscribers: [subscriber()],
      messCuts: [],
      guestTokens: -5,
      extraPlates: -3,
    });
    expect(result.projectedCount).toBe(1);
  });

  it("handles an empty mess", () => {
    const result = projectHeadcount({
      serviceDate: TODAY,
      mealSlot: "LUNCH",
      subscribers: [],
      messCuts: [],
    });
    expect(result.projectedCount).toBe(0);
    expect(result.breakdown.eligibleSubscribers).toBe(0);
  });
});

describe("calculateVariance", () => {
  it("reports under-attendance as negative — food cooked and not eaten", () => {
    const v = calculateVariance(TODAY, "LUNCH", 400, 370);
    expect(v.variance).toBe(-30);
    expect(v.variancePercent).toBe(-7.5);
  });

  it("reports over-attendance as positive", () => {
    const v = calculateVariance(TODAY, "LUNCH", 400, 412);
    expect(v.variance).toBe(12);
    expect(v.variancePercent).toBe(3);
  });

  it("reports a perfect projection as zero", () => {
    expect(calculateVariance(TODAY, "LUNCH", 400, 400).variancePercent).toBe(0);
  });

  it("does not divide by zero when nothing was projected", () => {
    expect(calculateVariance(TODAY, "LUNCH", 0, 0).variancePercent).toBe(0);
    expect(calculateVariance(TODAY, "LUNCH", 0, 5).variancePercent).toBe(100);
  });

  it("rounds the percentage to one decimal place", () => {
    expect(calculateVariance(TODAY, "LUNCH", 300, 299).variancePercent).toBe(-0.3);
  });
});
