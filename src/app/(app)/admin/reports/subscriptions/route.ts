/**
 * Every subscription, one per row — the detail behind the revenue summary.
 *
 * `price_paise_snapshot` is the only money record this system holds, so this
 * file *is* the revenue data at row level. It carries the dates as well as the
 * amount, so an accountant who wants revenue spread across months rather than
 * counted when collected can do that in a pivot table.
 */
import { subscriptionStateOf, subscriptionStateLabel } from "@/core/policies/subscription-state";
import { serviceDateOf, toServiceDate, eachDateInclusive } from "@/core/time";
import { createAdminClient } from "@/infra/supabase/admin";
import { csvDownload, rupees } from "@/infra/http/csv-download";
import { firstRelated } from "@/infra/supabase/mappers";

const COLUMNS = [
  "roll_number",
  "full_name",
  "plan_name",
  "start_date",
  "end_date",
  "days",
  "meals_included",
  "amount_paid_inr",
  "per_day_inr",
  "subscription_status",
  "state_today",
  "created_at",
] as const;

export async function GET(): Promise<Response> {
  return csvDownload(
    "SUBSCRIPTIONS_EXPORTED",
    (user) => `subscriptions-${serviceDateOf(user.timezone, new Date())}.csv`,
    async (user) => {
      const admin = createAdminClient();
      const today = serviceDateOf(user.timezone, new Date());

      const { data, error } = await admin
        .from("subscriptions")
        .select(
          `start_date, end_date, price_paise_snapshot, included_meal_slots_snapshot,
           status, created_at,
           students!inner ( roll_number, profiles!inner ( full_name ) ),
           plans ( name )`,
        )
        .eq("tenant_id", user.tenantId)
        .order("start_date", { ascending: false });

      if (error) throw new Error(error.message);

      const rows: string[][] = [[...COLUMNS]];
      let total = 0;

      for (const s of data ?? []) {
        const student = firstRelated<{ roll_number: string; profiles: unknown }>(
          s.students as never,
        );
        const profile = firstRelated<{ full_name: string }>(student?.profiles as never);
        const plan = firstRelated<{ name: string }>(s.plans as never);

        const start = toServiceDate(s.start_date);
        const end = toServiceDate(s.end_date);
        const days = eachDateInclusive(start, end).length;
        total += s.price_paise_snapshot;

        rows.push([
          student?.roll_number ?? "",
          profile?.full_name ?? "",
          plan?.name ?? "",
          s.start_date,
          s.end_date,
          String(days),
          (s.included_meal_slots_snapshot as string[]).join(" "),
          rupees(s.price_paise_snapshot),
          // Floored, so the per-day column can never sum to more than was
          // actually paid. The exact figure is `amount_paid_inr`.
          rupees(Math.floor(s.price_paise_snapshot / days)),
          s.status,
          subscriptionStateLabel(
            subscriptionStateOf({ status: s.status, startDate: start, endDate: end }, today),
          ),
          s.created_at,
        ]);
      }

      return { rows, meta: { totalPaise: total } };
    },
  );
}
