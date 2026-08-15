/**
 * Tests for the revenue summary.
 *
 * There is no ledger and no invoice table yet — `price_paise_snapshot` on a
 * subscription is the only money record that exists. So "revenue" here means
 * **what was collected**, and the honest way to report it is cash-basis: the
 * money lands in the month the plan starts.
 *
 * The alternative, spreading a 90-day plan across three months, is accrual
 * accounting, and it would be a guess — nothing records *when* the money
 * actually arrived, only what the plan was worth. Reporting a guess as revenue
 * is worse than reporting a simpler true thing, so the export carries the start
 * and end dates and lets an accountant do the spreading if they want it.
 *
 * A cancelled subscription still counts. The mess took the money; whether any
 * of it is owed back is a refund question that Phase 2's ledger will answer,
 * and silently dropping it here would understate collections.
 */
import { describe, expect, it } from "vitest";
import { summariseRevenue, type RevenueRow } from "@/core/policies/revenue.policy";

function sub(over: Partial<RevenueRow> = {}): RevenueRow {
  return {
    startDate: "2026-08-01",
    endDate: "2026-08-30",
    pricePaise: 520000,
    status: "ACTIVE",
    ...over,
  };
}

describe("summariseRevenue — grouping", () => {
  it("groups by the month the plan starts", () => {
    const out = summariseRevenue([
      sub({ startDate: "2026-07-01" }),
      sub({ startDate: "2026-07-15" }),
      sub({ startDate: "2026-08-02" }),
    ]);
    expect(out.map((m) => m.month)).toEqual(["2026-07", "2026-08"]);
    expect(out[0]!.subscriptions).toBe(2);
    expect(out[1]!.subscriptions).toBe(1);
  });

  it("sorts oldest first, so the file reads as a timeline", () => {
    const out = summariseRevenue([
      sub({ startDate: "2026-10-01" }),
      sub({ startDate: "2026-07-01" }),
      sub({ startDate: "2026-08-01" }),
    ]);
    expect(out.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-10"]);
  });

  it("returns nothing for no subscriptions", () => {
    expect(summariseRevenue([])).toEqual([]);
  });

  it("does not invent empty months between two real ones", () => {
    // A gap is information: the mess took nothing that month.
    const out = summariseRevenue([
      sub({ startDate: "2026-07-01" }),
      sub({ startDate: "2026-10-01" }),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("summariseRevenue — the money", () => {
  it("sums prices in integer paise", () => {
    const out = summariseRevenue([sub({ pricePaise: 520000 }), sub({ pricePaise: 480000 })]);
    expect(out[0]!.collectedPaise).toBe(1000000);
  });

  it("never uses floating point, so a long month cannot drift", () => {
    // Thirty rows at 5200.55 must be exactly 156016.50, not 156016.499999.
    const out = summariseRevenue(Array.from({ length: 30 }, () => sub({ pricePaise: 520055 })));
    expect(out[0]!.collectedPaise).toBe(15601650);
    expect(Number.isInteger(out[0]!.collectedPaise)).toBe(true);
  });

  it("counts a cancelled subscription — the money was still taken", () => {
    // Dropping it would understate collections. Whether any is owed back is a
    // refund question, and there is no ledger to answer it yet.
    const out = summariseRevenue([sub({ status: "CANCELLED" }), sub({ status: "ACTIVE" })]);
    expect(out[0]!.subscriptions).toBe(2);
    expect(out[0]!.collectedPaise).toBe(1040000);
  });

  it("reports what is still unpaid separately rather than hiding it", () => {
    // PENDING_PAYMENT is a promise, not a collection. Adding it to the same
    // total would tell the owner they hold money they have not received.
    const out = summariseRevenue([
      sub({ status: "ACTIVE", pricePaise: 520000 }),
      sub({ status: "PENDING_PAYMENT", pricePaise: 300000 }),
    ]);
    expect(out[0]!.collectedPaise).toBe(520000);
    expect(out[0]!.pendingPaise).toBe(300000);
    expect(out[0]!.subscriptions).toBe(2);
  });

  it("handles a month that is entirely unpaid", () => {
    const out = summariseRevenue([sub({ status: "PENDING_PAYMENT" })]);
    expect(out[0]!.collectedPaise).toBe(0);
    expect(out[0]!.pendingPaise).toBe(520000);
  });

  it("counts a zero-price plan without breaking the average", () => {
    // A waived or sponsored plan is legitimate.
    const out = summariseRevenue([sub({ pricePaise: 0 }), sub({ pricePaise: 520000 })]);
    expect(out[0]!.collectedPaise).toBe(520000);
    expect(out[0]!.subscriptions).toBe(2);
  });
});

describe("summariseRevenue — a month boundary is the tenant's, not UTC's", () => {
  it("uses the plain start date, which is already tenant-local", () => {
    // `start_date` is a DATE column derived in the tenant's timezone when the
    // subscription was created, so the month is a string slice — deriving it
    // from a Date here would reintroduce the UTC shift rule 9 exists to stop.
    const out = summariseRevenue([sub({ startDate: "2026-08-01" })]);
    expect(out[0]!.month).toBe("2026-08");
  });

  it("puts the last day of a month in that month", () => {
    expect(summariseRevenue([sub({ startDate: "2026-07-31" })])[0]!.month).toBe("2026-07");
  });

  it("puts the first day of a month in that month", () => {
    expect(summariseRevenue([sub({ startDate: "2026-08-01" })])[0]!.month).toBe("2026-08");
  });
});
