/**
 * Attendance persistence — the counter's hot path.
 *
 * This is the most safety-critical repository in the system. The idempotency
 * guarantee that stops double-serving is `UNIQUE (tenant_id, student_id,
 * service_date, meal_slot)`, and it only holds if the write actually relies on
 * that constraint.
 *
 * A read-then-write ("does a row exist? no? insert it") looks equivalent and is
 * not: two counters scanning the same student within the same few milliseconds
 * both read "no row", both insert, and one gets a raw constraint violation
 * surfaced as a 500 at the counter. The database must arbitrate, not the
 * application (§2.5).
 *
 * So the insert is `ON CONFLICT DO NOTHING RETURNING`, expressed through
 * supabase-js as `upsert(..., { ignoreDuplicates: true })`. An empty result
 * means the row already existed, which is a normal outcome — a double-tap, a
 * replayed offline-queue entry, or a shared screenshot — not an error.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MealSlot } from "@/core/domain/enums";
import type {
  AttendanceRecord,
  AttendanceRepository,
  RecordAttendanceInput,
  RecordAttendanceOutcome,
} from "@/core/ports/repositories";
import type { ServiceDate } from "@/core/time";
import { toServiceDate } from "@/core/time";
import type { Database } from "../database.types";

type AttendanceRow = Database["public"]["Tables"]["attendance"]["Row"];

function toRecord(row: AttendanceRow): AttendanceRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    serviceDate: toServiceDate(row.service_date),
    mealSlot: row.meal_slot,
    scannedAt: new Date(row.scanned_at),
    method: row.method,
  };
}

export class SupabaseAttendanceRepository implements AttendanceRepository {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async record(input: RecordAttendanceInput): Promise<RecordAttendanceOutcome> {
    const { data, error } = await this.db
      .from("attendance")
      .upsert(
        {
          tenant_id: input.tenantId,
          student_id: input.studentId,
          service_date: input.serviceDate,
          meal_slot: input.mealSlot,
          scanned_at: input.scannedAt.toISOString(),
          method: input.method,
          verified_by: input.verifiedBy,
          device_id: input.deviceId,
          override_reason: input.overrideReason,
        },
        {
          onConflict: "tenant_id,student_id,service_date,meal_slot",
          // ON CONFLICT DO NOTHING — never overwrite an existing scan. The
          // first record of a meal is the true one; a later scan must not be
          // able to rewrite its timestamp, method or the staff member who
          // verified it.
          ignoreDuplicates: true,
        },
      )
      .select();

    // A genuine fault (network, permissions). Throwing is correct: the use case
    // catches it and fails closed, and the scanner queues for retry.
    if (error) {
      throw new Error(`attendance upsert failed: ${error.message}`);
    }

    const inserted = data?.[0];
    if (inserted) {
      return { created: true, record: toRecord(inserted) };
    }

    // Conflict: the student has already eaten this meal. Fetch the existing row
    // so the scanner can show *when* they were served and by which method —
    // staff need that to settle the argument at the counter.
    const { data: existing, error: fetchError } = await this.db
      .from("attendance")
      .select("*")
      .eq("tenant_id", input.tenantId)
      .eq("student_id", input.studentId)
      .eq("service_date", input.serviceDate)
      .eq("meal_slot", input.mealSlot)
      .single();

    if (fetchError || !existing) {
      throw new Error(
        `attendance conflict but existing row unreadable: ${fetchError?.message ?? "not found"}`,
      );
    }

    return { created: false, existing: toRecord(existing) };
  }

  async countForMeal(
    tenantId: string,
    serviceDate: ServiceDate,
    mealSlot: MealSlot,
  ): Promise<number> {
    const { count, error } = await this.db
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("service_date", serviceDate)
      .eq("meal_slot", mealSlot);

    if (error) throw new Error(`attendance count failed: ${error.message}`);
    return count ?? 0;
  }
}
