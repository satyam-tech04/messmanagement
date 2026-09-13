/**
 * Which of a student's terms a pause applies to.
 *
 * Since renewals (migration 017) a student can hold several ACTIVE rows at once:
 * the term they are eating on, the next one they paid for early, and any
 * finished term whose column was never flipped. The pause actions read
 * `status = ACTIVE … maybeSingle()`, which errors on two rows — so the moment a
 * student renewed, the admin was told "This student has no plan to pause".
 *
 * The page and the actions must also agree on the answer. The page picked the
 * *latest* upcoming term from a newest-first list; pausing "the upcoming plan"
 * must mean the one that starts next.
 */
import { describe, expect, it } from "vitest";
import { pausableSubscription, type SubscriptionDates } from "@/core/policies/subscription-state";
import { toServiceDate } from "@/core/time";

const today = toServiceDate("2026-09-13");

function term(id: string, start: string, end: string, status = "ACTIVE") {
  return {
    id,
    status,
    startDate: toServiceDate(start),
    endDate: toServiceDate(end),
  } satisfies SubscriptionDates & { id: string };
}

describe("pausableSubscription", () => {
  it("is the running term when there is one", () => {
    const running = term("sep", "2026-09-01", "2026-09-30");
    expect(pausableSubscription([running], today)?.id).toBe("sep");
  });

  it("stays on the running term after an early renewal", () => {
    const subs = [term("oct", "2026-10-01", "2026-10-31"), term("sep", "2026-09-01", "2026-09-30")];
    expect(pausableSubscription(subs, today)?.id).toBe("sep");
  });

  it("ignores a finished term that still reads ACTIVE", () => {
    const subs = [term("aug", "2026-08-01", "2026-08-31"), term("sep", "2026-09-01", "2026-09-30")];
    expect(pausableSubscription(subs, today)?.id).toBe("sep");
  });

  it("is the soonest upcoming term when nothing is running", () => {
    const subs = [
      term("nov", "2026-11-01", "2026-11-30"),
      term("oct", "2026-10-01", "2026-10-31"),
      term("aug", "2026-08-01", "2026-08-31"),
    ];
    expect(pausableSubscription(subs, today)?.id).toBe("oct");
  });

  it("never offers a cancelled term, even one whose dates cover today", () => {
    const subs = [term("sep", "2026-09-01", "2026-09-30", "CANCELLED")];
    expect(pausableSubscription(subs, today)).toBeNull();
  });

  it("is null when every term has finished", () => {
    expect(pausableSubscription([term("aug", "2026-08-01", "2026-08-31")], today)).toBeNull();
  });

  it("is null for a student with no subscriptions", () => {
    expect(pausableSubscription([], today)).toBeNull();
  });
});
