/**
 * What the mess has collected, summarised by month.
 *
 * There is no ledger and no invoice table yet — `price_paise_snapshot` on a
 * subscription is the only money record that exists. So "revenue" here means
 * **collections**, reported cash-basis: the money lands in the month the plan
 * starts.
 *
 * Spreading a 90-day plan across three months would be accrual accounting, and
 * here it would be a guess — nothing records when the money actually arrived,
 * only what the plan was worth. Reporting a guess as revenue is worse than
 * reporting a simpler true thing, so the row-level export carries the start and
 * end dates and an accountant can do the spreading if they want it.
 *
 * Paid and unpaid are kept apart. `PENDING_PAYMENT` is a promise, and folding
 * it into one total would tell an owner they hold money they have not received.
 */
import type { ServiceDate } from "../time";

export interface RevenueRow {
  readonly startDate: ServiceDate | string;
  readonly endDate: ServiceDate | string;
  readonly pricePaise: number;
  readonly status: string;
}

export interface RevenueMonth {
  /** `YYYY-MM`, from the tenant-local start date. */
  readonly month: string;
  readonly subscriptions: number;
  /** Money actually taken. */
  readonly collectedPaise: number;
  /** Agreed but not yet received. */
  readonly pendingPaise: number;
}

/** Only this status means the money has not arrived. */
const UNPAID = "PENDING_PAYMENT";

export function summariseRevenue(rows: readonly RevenueRow[]): RevenueMonth[] {
  const months = new Map<string, { subscriptions: number; collected: number; pending: number }>();

  for (const row of rows) {
    // A string slice, not a Date. `start_date` is a DATE column already derived
    // in the tenant's timezone; parsing it into an instant here would
    // reintroduce exactly the UTC shift rule 9 exists to prevent, and a plan
    // starting on the 1st would be reported in the previous month.
    const month = String(row.startDate).slice(0, 7);

    const bucket = months.get(month) ?? { subscriptions: 0, collected: 0, pending: 0 };
    bucket.subscriptions += 1;

    // Integer paise throughout — thirty rows at ₹5200.55 must total exactly
    // ₹156,016.50, and floating point would not guarantee that.
    if (row.status === UNPAID) bucket.pending += row.pricePaise;
    else bucket.collected += row.pricePaise;

    months.set(month, bucket);
  }

  return (
    [...months.entries()]
      // Oldest first, so the file reads as a timeline. Gaps are left as gaps: a
      // month with no subscriptions is information, not a missing row.
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, b]) => ({
        month,
        subscriptions: b.subscriptions,
        collectedPaise: b.collected,
        pendingPaise: b.pending,
      }))
  );
}
