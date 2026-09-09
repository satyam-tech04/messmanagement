/**
 * Projected against served, per meal.
 *
 * Shared by the web live-count page and `GET /api/staff/counts` so both answer
 * the same way on the rule that matters: **a locked snapshot wins.** Once the
 * cron has locked a meal's projection, that is the number the kitchen cooked to
 * and it must not move afterwards, even as subscriptions change underneath.
 * Recomputing it live would quietly rewrite history the mess has already acted
 * on.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { projectHeadcount } from "@/core/policies/headcount.policy";
import { serviceDateOf } from "@/core/time";
import type { SessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { createRepositories } from "@/infra/supabase/repositories";
import type { Database } from "@/infra/supabase/database.types";

export interface SlotCount {
  readonly mealSlot: string;
  readonly label: string;
  /** How many the kitchen should cook for. */
  readonly projected: number;
  readonly served: number;
  /** True once the snapshot is locked; the projection then stops moving. */
  readonly locked: boolean;
}

export interface StaffCounts {
  readonly serviceDate: string;
  readonly slots: readonly SlotCount[];
}

export async function readStaffCounts(
  supabase: SupabaseClient<Database>,
  user: SessionUser,
): Promise<StaffCounts | null> {
  const repos = createRepositories(supabase, createAdminClient());
  const serviceDate = serviceDateOf(user.timezone, new Date());
  const settings = await repos.tenants.getSettings(user.tenantId);

  // Fail closed: without meal times there are no slots to count, and inventing
  // a default would show the kitchen a number for a meal that does not exist.
  if (!settings) return null;

  const [snapshots, subscribers, cuts, attendance] = await Promise.all([
    repos.headcountSnapshots.findForDate(user.tenantId, serviceDate),
    repos.subscriptions.findActiveCovering(user.tenantId, serviceDate),
    repos.messCuts.findCoveringDate(user.tenantId, serviceDate),
    supabase
      .from("attendance")
      .select("meal_slot")
      .eq("tenant_id", user.tenantId)
      .eq("service_date", serviceDate)
      // A reversed meal never happened.
      .is("reversed_at", null),
  ]);

  const servedBySlot = new Map<string, number>();
  for (const row of attendance.data ?? []) {
    servedBySlot.set(row.meal_slot, (servedBySlot.get(row.meal_slot) ?? 0) + 1);
  }

  return {
    serviceDate,
    slots: settings.mealSlots.map((config) => {
      const snapshot = snapshots.find((s) => s.mealSlot === config.slot);

      return {
        mealSlot: config.slot,
        label: config.slot.charAt(0) + config.slot.slice(1).toLowerCase(),
        projected:
          snapshot?.lockedAt != null
            ? snapshot.projectedCount
            : projectHeadcount({
                serviceDate,
                mealSlot: config.slot,
                subscribers,
                messCuts: cuts,
              }).projectedCount,
        served: servedBySlot.get(config.slot) ?? 0,
        locked: Boolean(snapshot?.lockedAt),
      };
    }),
  };
}
