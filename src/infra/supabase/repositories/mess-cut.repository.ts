/**
 * Mess cut lookups.
 *
 * Only APPROVED and CREDITED cuts are ever returned — the domain filters again
 * via `isCutFromMeal`, but narrowing here keeps the payload small on the scan
 * path and makes the intent obvious at the query.
 *
 * Range containment is expressed as `date_from <= d AND date_to >= d`, which
 * matches the `(tenant_id, date_from, date_to, status)` index.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessCutSnapshot } from "@/core/policies/headcount.policy";
import type { MessCutRepository } from "@/core/ports/repositories";
import { toServiceDate, type ServiceDate } from "@/core/time";
import type { Database } from "../database.types";

type Row = Database["public"]["Tables"]["mess_cuts"]["Row"];

const ACTIVE_STATUSES = ["APPROVED", "CREDITED"] as const;

function toSnapshot(row: Row): MessCutSnapshot {
  return {
    studentId: row.student_id,
    dateFrom: toServiceDate(row.date_from),
    dateTo: toServiceDate(row.date_to),
    mealSlots: row.meal_slots,
    status: row.status,
  };
}

export class SupabaseMessCutRepository implements MessCutRepository {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async findCoveringDate(tenantId: string, serviceDate: ServiceDate): Promise<MessCutSnapshot[]> {
    const { data, error } = await this.db
      .from("mess_cuts")
      .select("*")
      .eq("tenant_id", tenantId)
      .lte("date_from", serviceDate)
      .gte("date_to", serviceDate)
      .in("status", ACTIVE_STATUSES);

    if (error) throw new Error(`mess cut lookup failed: ${error.message}`);
    return (data ?? []).map(toSnapshot);
  }

  async findForStudentOnDate(
    tenantId: string,
    studentId: string,
    serviceDate: ServiceDate,
  ): Promise<MessCutSnapshot[]> {
    const { data, error } = await this.db
      .from("mess_cuts")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .lte("date_from", serviceDate)
      .gte("date_to", serviceDate)
      .in("status", ACTIVE_STATUSES);

    if (error) throw new Error(`student mess cut lookup failed: ${error.message}`);
    return (data ?? []).map(toSnapshot);
  }
}
