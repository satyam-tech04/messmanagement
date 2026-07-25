/**
 * Student lookup for the counter.
 *
 * Both methods fetch the student, their profile and their active subscription
 * in ONE round trip via a nested select. That matters: this runs on the scan
 * path, where the p95 budget is 500 ms and there are roughly six seconds per
 * student including walking (§6.4). Three sequential queries here would be the
 * difference between a moving queue and a stalled one.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MealSlot } from "@/core/domain/enums";
import type { StudentForVerification, StudentRepository } from "@/core/ports/repositories";
import { toServiceDate } from "@/core/time";
import type { Database } from "../database.types";

/**
 * One active subscription per student is guaranteed by a partial unique index
 * (`subscriptions_one_active_per_student`), so taking the first row is safe
 * rather than arbitrary.
 */
const SELECT = `
  id, tenant_id, roll_number, status,
  profiles!inner ( full_name, photo_url ),
  subscriptions ( id, status, start_date, end_date, included_meal_slots_snapshot )
` as const;

type Row = {
  id: string;
  tenant_id: string;
  roll_number: string;
  status: Database["public"]["Enums"]["student_status"];
  profiles: { full_name: string; photo_url: string | null } | null;
  subscriptions: Array<{
    id: string;
    status: Database["public"]["Enums"]["subscription_status"];
    start_date: string;
    end_date: string;
    included_meal_slots_snapshot: MealSlot[];
  }> | null;
};

function toStudent(row: Row): StudentForVerification {
  const active = row.subscriptions?.find((s) => s.status === "ACTIVE") ?? null;

  return {
    studentId: row.id,
    tenantId: row.tenant_id,
    rollNumber: row.roll_number,
    fullName: row.profiles?.full_name ?? "(unknown)",
    photoUrl: row.profiles?.photo_url ?? null,
    status: row.status,
    subscription: active
      ? {
          id: active.id,
          status: active.status,
          startDate: toServiceDate(active.start_date),
          endDate: toServiceDate(active.end_date),
          includedMealSlots: active.included_meal_slots_snapshot,
        }
      : null,
  };
}

export class SupabaseStudentRepository implements StudentRepository {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async findForVerification(
    tenantId: string,
    studentId: string,
  ): Promise<StudentForVerification | null> {
    const { data, error } = await this.db
      .from("students")
      .select(SELECT)
      .eq("tenant_id", tenantId)
      .eq("id", studentId)
      .maybeSingle();

    if (error) throw new Error(`student lookup failed: ${error.message}`);
    return data ? toStudent(data as unknown as Row) : null;
  }

  async findByRollNumber(
    tenantId: string,
    rollNumber: string,
  ): Promise<StudentForVerification | null> {
    // Case-insensitive, matching the `lower(roll_number)` unique index. Staff
    // type this under time pressure at the counter; 'cs21b001' must find
    // 'CS21B001'.
    const { data, error } = await this.db
      .from("students")
      .select(SELECT)
      .eq("tenant_id", tenantId)
      .ilike("roll_number", rollNumber.trim())
      .maybeSingle();

    if (error) throw new Error(`student roll lookup failed: ${error.message}`);
    return data ? toStudent(data as unknown as Row) : null;
  }
}
