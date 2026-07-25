/**
 * Tests for how a cron invocation decides what to do.
 *
 * Vercel's Hobby plan allows only **once-per-day** cron expressions — anything
 * more frequent fails at deploy time — and fires with ±59 minutes of slack. So
 * each meal gets its own daily schedule, and the job works out which meal to
 * lock from the schedule that triggered it.
 */
import { describe, expect, it } from "vitest";
import { cronPlanFor } from "@/lib/cron-plan";

describe("cronPlanFor — from the Vercel schedule header", () => {
  it("locks lunch on the schedule set 12h before lunch", () => {
    // 18:30 UTC = 00:00 IST, twelve hours before the 12:00 IST lunch window.
    const plan = cronPlanFor({ schedule: "30 18 * * *", params: new URLSearchParams() });
    expect(plan.lock).toBe(true);
    expect(plan.slots).toEqual(["LUNCH"]);
  });

  it("locks dinner on the schedule set 12h before dinner", () => {
    // 02:00 UTC = 07:30 IST, twelve hours before the 19:30 IST dinner window.
    const plan = cronPlanFor({ schedule: "0 2 * * *", params: new URLSearchParams() });
    expect(plan.lock).toBe(true);
    expect(plan.slots).toEqual(["DINNER"]);
  });

  it("locks only one meal per run — locking both would freeze dinner a day early", () => {
    const lunch = cronPlanFor({ schedule: "30 18 * * *", params: new URLSearchParams() });
    expect(lunch.slots).toHaveLength(1);
  });

  it("falls back to an unlocked refresh of every slot for an unrecognised schedule", () => {
    // A schedule added later must not silently lock the wrong meal.
    const plan = cronPlanFor({ schedule: "0 5 * * *", params: new URLSearchParams() });
    expect(plan.lock).toBe(false);
    expect(plan.slots).toBeUndefined();
  });

  it("falls back safely when no schedule header is present", () => {
    const plan = cronPlanFor({ schedule: null, params: new URLSearchParams() });
    expect(plan.lock).toBe(false);
    expect(plan.slots).toBeUndefined();
  });
});

describe("cronPlanFor — explicit query parameters win", () => {
  it("honours ?lock=true for a manual run", () => {
    const plan = cronPlanFor({ schedule: null, params: new URLSearchParams("lock=true") });
    expect(plan.lock).toBe(true);
  });

  it("treats any other lock value as false, so a typo cannot lock a count", () => {
    for (const value of ["1", "yes", "TRUE", ""]) {
      const plan = cronPlanFor({
        schedule: null,
        params: new URLSearchParams(`lock=${value}`),
      });
      expect(plan.lock).toBe(false);
    }
  });

  it("honours an explicit slot list", () => {
    const plan = cronPlanFor({ schedule: null, params: new URLSearchParams("slots=LUNCH,DINNER") });
    expect(plan.slots).toEqual(["LUNCH", "DINNER"]);
  });

  it("ignores unknown slot names rather than passing them to the database", () => {
    const plan = cronPlanFor({ schedule: null, params: new URLSearchParams("slots=LUNCH,BRUNCH") });
    expect(plan.slots).toEqual(["LUNCH"]);
  });

  it("treats an all-invalid slot list as unspecified, not as an empty run", () => {
    // An empty array would snapshot nothing at all and report success.
    const plan = cronPlanFor({ schedule: null, params: new URLSearchParams("slots=BRUNCH") });
    expect(plan.slots).toBeUndefined();
  });

  it("lets a manual override beat the schedule header", () => {
    const plan = cronPlanFor({
      schedule: "30 18 * * *",
      params: new URLSearchParams("lock=false&slots=DINNER"),
    });
    expect(plan.lock).toBe(false);
    expect(plan.slots).toEqual(["DINNER"]);
  });
});
