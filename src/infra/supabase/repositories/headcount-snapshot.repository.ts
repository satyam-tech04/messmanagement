/**
 * Headcount snapshots.
 *
 * The write upserts on `(tenant_id, service_date, meal_slot)` — the table's
 * unique constraint — rather than read-then-write. The cron fires twice some
 * days, and a duplicated snapshot would leave the kitchen with two different
 * numbers and no way to tell which one was cooked to.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MealSlot } from "@/core/domain/enums";
import type { HeadcountSnapshotRepository, HeadcountSnapshotRow } from "@/core/ports/repositories";
import { toServiceDate, type ServiceDate } from "@/core/time";
import type { Database } from "../database.types";

type Row = Database["public"]["Tables"]["headcount_snapshots"]["Row"];

function toSnapshot(row: Row): HeadcountSnapshotRow {
  return {
    serviceDate: toServiceDate(row.service_date),
    mealSlot: row.meal_slot,
    projectedCount: row.projected_count,
    guestCount: row.guest_count,
    extraPlateCount: row.extra_plate_count,
    lockedAt: row.locked_at ? new Date(row.locked_at) : null,
  };
}

export class SupabaseHeadcountSnapshotRepository implements HeadcountSnapshotRepository {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async find(
    tenantId: string,
    serviceDate: ServiceDate,
    mealSlot: MealSlot,
  ): Promise<HeadcountSnapshotRow | null> {
    const { data, error } = await this.db
      .from("headcount_snapshots")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("service_date", serviceDate)
      .eq("meal_slot", mealSlot)
      .maybeSingle();

    if (error) throw new Error(`headcount snapshot read failed: ${error.message}`);
    return data ? toSnapshot(data) : null;
  }

  async findForDate(tenantId: string, serviceDate: ServiceDate): Promise<HeadcountSnapshotRow[]> {
    const { data, error } = await this.db
      .from("headcount_snapshots")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("service_date", serviceDate);

    if (error) throw new Error(`headcount snapshot read failed: ${error.message}`);
    return (data ?? []).map(toSnapshot);
  }

  async upsert(input: {
    tenantId: string;
    serviceDate: ServiceDate;
    mealSlot: MealSlot;
    projectedCount: number;
    guestCount: number;
    extraPlateCount: number;
    lockedAt: Date | null;
  }): Promise<void> {
    const { error } = await this.db.from("headcount_snapshots").upsert(
      {
        tenant_id: input.tenantId,
        service_date: input.serviceDate,
        meal_slot: input.mealSlot,
        projected_count: input.projectedCount,
        guest_count: input.guestCount,
        extra_plate_count: input.extraPlateCount,
        locked_at: input.lockedAt ? input.lockedAt.toISOString() : null,
      },
      { onConflict: "tenant_id,service_date,meal_slot" },
    );

    if (error) throw new Error(`headcount snapshot write failed: ${error.message}`);
  }
}
