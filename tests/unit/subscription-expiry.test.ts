/**
 * A subscription whose end date has passed is over, whatever its status column
 * says.
 *
 * Nothing sweeps the table — the `expire-subscriptions` job is Phase 2 — so
 * rows sit at ACTIVE long after they finish. Found on the live database with
 * seven of them. The consequences all compound on one another:
 *
 *   - the student is told "your plan does not cover today", which is true but
 *     tells them nothing about what to do
 *   - the admin cannot assign a replacement, because the partial unique index
 *     allows only one ACTIVE row per student, so the app demands they "End
 *     plan" — wording that reads like cancelling something current
 *   - every list calls it "Active until 31 Jul", labelling an expired plan as
 *     active
 *
 * Deriving the state from the dates instead of trusting the column fixes all
 * three at once, and does not need a migration or a cron.
 */
import { describe, expect, it } from "vitest";
import {
  subscriptionStateOf,
  isReplaceable,
  type SubscriptionDates,
} from "@/core/policies/subscription-state";
import { toServiceDate } from "@/core/time";

const today = toServiceDate("2026-08-15");

function sub(over: Partial<SubscriptionDates> = {}): SubscriptionDates {
  return {
    status: "ACTIVE",
    startDate: toServiceDate("2026-08-01"),
    endDate: toServiceDate("2026-08-31"),
    ...over,
  };
}

describe("subscriptionStateOf", () => {
  it("is running when today falls inside the period", () => {
    expect(subscriptionStateOf(sub(), today)).toBe("RUNNING");
  });

  it("is EXPIRED once the end date has passed, whatever the column says", () => {
    // The exact live case: status ACTIVE, ended 31 July, today is 15 August.
    const state = subscriptionStateOf(
      sub({ startDate: toServiceDate("2026-07-01"), endDate: toServiceDate("2026-07-31") }),
      today,
    );
    expect(state).toBe("EXPIRED");
  });

  it("counts the last day as still running — the period is inclusive", () => {
    expect(subscriptionStateOf(sub({ endDate: today }), today)).toBe("RUNNING");
  });

  it("is SCHEDULED before it begins, rather than pretending to be active", () => {
    // A plan assigned with a future start date. The student needs to know they
    // cannot eat yet and when they can, not that something is wrong.
    const state = subscriptionStateOf(sub({ startDate: toServiceDate("2026-08-20") }), today);
    expect(state).toBe("SCHEDULED");
  });

  it("counts the first day as running", () => {
    expect(subscriptionStateOf(sub({ startDate: today }), today)).toBe("RUNNING");
  });

  it("reports a cancelled subscription as ended, not by its dates", () => {
    expect(subscriptionStateOf(sub({ status: "CANCELLED" }), today)).toBe("CANCELLED");
  });

  it("reports an already-EXPIRED row as expired", () => {
    expect(subscriptionStateOf(sub({ status: "EXPIRED" }), today)).toBe("EXPIRED");
  });

  it("does not call a cancelled-but-still-dated row running", () => {
    const state = subscriptionStateOf(sub({ status: "CANCELLED", endDate: today }), today);
    expect(state).toBe("CANCELLED");
  });
});

describe("isReplaceable — may a new plan take its place?", () => {
  it("allows replacing a plan that has run out", () => {
    // Without this the admin has to click "End plan" on something that already
    // ended, which reads like cancelling a live subscription.
    const expired = sub({
      startDate: toServiceDate("2026-07-01"),
      endDate: toServiceDate("2026-07-31"),
    });
    expect(isReplaceable(expired, today)).toBe(true);
  });

  it("refuses to silently replace a plan that is still running", () => {
    // Ending a live plan is a real decision with a reason attached; it must not
    // happen as a side effect of assigning another.
    expect(isReplaceable(sub(), today)).toBe(false);
  });

  it("refuses to replace one that has not started yet", () => {
    // Also a live decision — the admin may have deliberately scheduled it.
    expect(isReplaceable(sub({ startDate: toServiceDate("2026-08-20") }), today)).toBe(false);
  });

  it("treats an absent subscription as replaceable", () => {
    expect(isReplaceable(null, today)).toBe(true);
  });

  it("treats a cancelled one as replaceable", () => {
    expect(isReplaceable(sub({ status: "CANCELLED" }), today)).toBe(true);
  });
});

describe("subscriptionStateOf — what the label should read", () => {
  it("never describes an ended plan as active", () => {
    const ended = sub({
      startDate: toServiceDate("2026-07-01"),
      endDate: toServiceDate("2026-07-31"),
    });
    expect(subscriptionStateOf(ended, today)).not.toBe("RUNNING");
  });
});
