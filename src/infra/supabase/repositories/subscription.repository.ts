/**
 * Subscriber lookup for the headcount projection (§8).
 *
 * Returns the SNAPSHOTTED meal slots from the subscription, never the plan's
 * current ones. When the admin edits a plan mid-cycle, existing subscribers
 * must keep the terms they signed up under — reading the plan here would make
 * an unrelated admin edit silently change tonight's headcount.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MealSlot } from "@/core/domain/enums";
import type { SubscriberSnapshot } from "@/core/policies/headcount.policy";
import type { SubscriptionRepository } from "@/core/ports/repositories";
import { toServiceDate, type ServiceDate } from "@/core/time";
import type { Database } from "../database.types";

type Row = {
  id: string;
  student_id: string;
  status: Database["public"]["Enums"]["subscription_status"];
  start_date: string;
  end_date: string;
  included_meal_slots_snapshot: MealSlot[];
  students: { status: Database["public"]["Enums"]["student_status"] } | null;
};

export class SupabaseSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async findActiveCovering(
    tenantId: string,
    serviceDate: ServiceDate,
  ): Promise<SubscriberSnapshot[]> {
    const { data, error } = await this.db
      .from("subscriptions")
      .select(
        `id, student_id, status, start_date, end_date, included_meal_slots_snapshot,
         students!inner ( status )`,
      )
      .eq("tenant_id", tenantId)
      .eq("status", "ACTIVE")
      .lte("start_date", serviceDate)
      .gte("end_date", serviceDate);

    if (error) throw new Error(`subscriber lookup failed: ${error.message}`);

    return ((data ?? []) as unknown as Row[]).map((row) => ({
      studentId: row.student_id,
      // A BLOCKED student is excluded by the projection, so their status has to
      // travel with the subscription rather than being assumed ACTIVE.
      studentStatus: row.students?.status ?? "INACTIVE",
      subscriptionStatus: row.status,
      startDate: toServiceDate(row.start_date),
      endDate: toServiceDate(row.end_date),
      includedMealSlots: row.included_meal_slots_snapshot,
    }));
  }
}
