/**
 * Which meals a student may rate, and what they said already.
 *
 * Only meals they actually ate, within the lookback window the policy allows.
 * Both bounds matter: rating a meal you did not attend is noise in a signal the
 * kitchen acts on, and rating one from three weeks ago is a memory rather than
 * a report.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, serviceDateOf, toServiceDate } from "@/core/time";
import type { SessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";
import type { Database } from "@/infra/supabase/database.types";

/** Matches `MAX_LOOKBACK_DAYS` in the feedback policy. */
const LOOKBACK_DAYS = 7;

export interface FeedbackTarget {
  readonly serviceDate: string;
  readonly mealSlot: string;
  readonly label: string;
  /** Null until they rate it; resubmitting replaces rather than adds. */
  readonly existingRating: number | null;
  readonly existingComment: string | null;
}

export interface StudentFeedback {
  readonly enabled: boolean;
  readonly today: string;
  readonly targets: readonly FeedbackTarget[];
}

export async function readStudentFeedback(
  supabase: SupabaseClient<Database>,
  user: SessionUser,
): Promise<StudentFeedback> {
  const today = serviceDateOf(user.timezone, new Date());
  const settings = await new SupabaseTenantRepository(supabase, createAdminClient()).getSettings(
    user.tenantId,
  );

  // Off by default. The screen must say so rather than show an empty list,
  // which would read as "nothing to rate" instead of "not collected here".
  if (!settings?.allowFeedback) {
    return { enabled: false, today, targets: [] };
  }

  const since = addDays(toServiceDate(today), -LOOKBACK_DAYS);

  const [attendance, existing] = await Promise.all([
    supabase
      .from("attendance")
      .select("service_date, meal_slot")
      .eq("tenant_id", user.tenantId)
      .gte("service_date", since)
      .lte("service_date", today)
      // A reversed meal never happened, so there is nothing to rate.
      .is("reversed_at", null)
      .order("service_date", { ascending: false }),
    supabase
      .from("meal_feedback")
      .select("service_date, meal_slot, rating, comment")
      .eq("tenant_id", user.tenantId)
      .gte("service_date", since),
  ]);

  const said = new Map(
    (existing.data ?? []).map((r) => [
      `${r.service_date}|${r.meal_slot}`,
      { rating: r.rating as number, comment: r.comment as string | null },
    ]),
  );

  return {
    enabled: true,
    today,
    targets: (attendance.data ?? []).map((row) => {
      const prior = said.get(`${row.service_date}|${row.meal_slot}`);
      return {
        serviceDate: row.service_date,
        mealSlot: row.meal_slot,
        label: row.meal_slot.charAt(0) + row.meal_slot.slice(1).toLowerCase(),
        existingRating: prior?.rating ?? null,
        existingComment: prior?.comment ?? null,
      };
    }),
  };
}
