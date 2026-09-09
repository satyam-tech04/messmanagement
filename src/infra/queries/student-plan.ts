/**
 * A student's subscription history.
 *
 * The one rule worth stating: **the live state is derived from the dates, not
 * read from the status column.** A subscription whose dates have passed is over
 * whether or not a sweep has got round to marking it EXPIRED, and a student
 * looking at their plan must be told the truth rather than the last thing a
 * cron job wrote.
 *
 * Money leaves here as integer paise. Rupees exist only at the render boundary.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { subscriptionStateOf } from "@/core/policies/subscription-state";
import { serviceDateOf, toServiceDate } from "@/core/time";
import type { SessionUser } from "@/infra/auth/session";
import { firstRelated } from "@/infra/supabase/mappers";
import type { Database } from "@/infra/supabase/database.types";

export interface StudentSubscription {
  readonly id: string;
  readonly planName: string | null;
  readonly durationDays: number | null;
  readonly startDate: string;
  readonly endDate: string;
  readonly pricePaise: number;
  readonly includedMealSlots: readonly string[];
  /** Derived from the dates today, not the stored status. */
  readonly state: string;
  /** Floored, so the parts can never sum above what was paid. */
  readonly perMealPaise: number | null;
}

export interface StudentPlan {
  readonly today: string;
  readonly current: StudentSubscription | null;
  readonly history: readonly StudentSubscription[];
}

export async function readStudentPlan(
  supabase: SupabaseClient<Database>,
  user: SessionUser,
): Promise<StudentPlan> {
  const today = serviceDateOf(user.timezone, new Date());

  // RLS (`subscriptions_read_own`) restricts this to the caller's own rows; the
  // tenant filter is the application layer saying the same thing (rule 8).
  const { data } = await supabase
    .from("subscriptions")
    .select(
      `id, status, start_date, end_date, price_paise_snapshot,
       included_meal_slots_snapshot, created_at,
       plans ( name, duration_days )`,
    )
    .eq("tenant_id", user.tenantId)
    .order("start_date", { ascending: false });

  const all = (data ?? []).map((row): StudentSubscription => {
    const plan = firstRelated<{ name: string; duration_days: number }>(row.plans as never);
    const slots = (row.included_meal_slots_snapshot as string[]) ?? [];

    // Meals the plan actually promises across its whole period. Dividing by
    // days alone would overstate the per-meal rate for a plan covering two of
    // four slots.
    const meals = plan ? plan.duration_days * slots.length : 0;

    return {
      id: row.id,
      planName: plan?.name ?? null,
      durationDays: plan?.duration_days ?? null,
      startDate: row.start_date,
      endDate: row.end_date,
      pricePaise: row.price_paise_snapshot,
      includedMealSlots: slots,
      state: subscriptionStateOf(
        {
          status: row.status,
          startDate: toServiceDate(row.start_date),
          endDate: toServiceDate(row.end_date),
        },
        today,
      ),
      perMealPaise: meals > 0 ? Math.floor(row.price_paise_snapshot / meals) : null,
    };
  });

  return {
    today,
    current: all.find((s) => s.state === "RUNNING" || s.state === "GRACE") ?? null,
    history: all,
  };
}
