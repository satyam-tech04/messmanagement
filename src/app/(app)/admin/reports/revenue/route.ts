/**
 * Collections by month.
 *
 * Cash-basis: the money lands in the month the plan starts, because nothing
 * records when it actually arrived — see `revenue.policy.ts`. Paid and unpaid
 * are separate columns so the owner is never told they hold money they have not
 * received.
 */
import { summariseRevenue } from "@/core/policies/revenue.policy";
import { serviceDateOf } from "@/core/time";
import { createAdminClient } from "@/infra/supabase/admin";
import { csvDownload, rupees } from "@/infra/http/csv-download";

const COLUMNS = [
  "month",
  "subscriptions",
  "collected_inr",
  "pending_inr",
  "total_agreed_inr",
] as const;

export async function GET(): Promise<Response> {
  return csvDownload(
    "REVENUE_EXPORTED",
    (user) => `revenue-${serviceDateOf(user.timezone, new Date())}.csv`,
    async (user) => {
      const admin = createAdminClient();

      const { data, error } = await admin
        .from("subscriptions")
        .select("start_date, end_date, price_paise_snapshot, status")
        .eq("tenant_id", user.tenantId);

      if (error) throw new Error(error.message);

      const months = summariseRevenue(
        (data ?? []).map((s) => ({
          startDate: s.start_date,
          endDate: s.end_date,
          pricePaise: s.price_paise_snapshot,
          status: s.status,
        })),
      );

      const rows: string[][] = [[...COLUMNS]];
      for (const m of months) {
        rows.push([
          m.month,
          String(m.subscriptions),
          rupees(m.collectedPaise),
          rupees(m.pendingPaise),
          rupees(m.collectedPaise + m.pendingPaise),
        ]);
      }

      return { rows, meta: { months: months.length } };
    },
  );
}
