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
    // A plain INSERT, with the unique violation treated as the duplicate case.
    //
    // `ON CONFLICT (cols)` cannot infer a **partial** unique index — Postgres
    // requires the predicate and supabase-js has no way to express it. Since
    // reversals arrived, the index is partial (live rows only), so upsert fails
    // outright with 42P10.
    //
    // Letting the insert raise 23505 keeps the guarantee exactly where it was:
    // the database, not application code, decides who was first. Two counters
    // inserting at the same instant still produce one row and one violation.
    const { data, error } = await this.db
      .from("attendance")
      .insert({
        tenant_id: input.tenantId,
        student_id: input.studentId,
        service_date: input.serviceDate,
        meal_slot: input.mealSlot,
        scanned_at: input.scannedAt.toISOString(),
        method: input.method,
        verified_by: input.verifiedBy,
        device_id: input.deviceId,
        override_reason: input.overrideReason,
      })
      .select()
      .single();

    if (!error && data) return { created: true, record: toRecord(data) };

    // Anything other than a uniqueness violation is a genuine fault. Throwing
    // is correct: the use case catches it and fails closed, and the scanner
    // queues the scan for retry.
    if (error && error.code !== "23505") {
      throw new Error(`attendance insert failed: ${error.message}`);
    }

    // Already eaten. Fetch the live row so the scanner can show *when* they
    // were served and by which method — staff need that to settle the argument
    // at the counter. A reversed row is deliberately excluded: it means the
    // meal was recorded in error, so it must not masquerade as a duplicate.
    const { data: existing, error: fetchError } = await this.db
      .from("attendance")
      .select("*")
      .eq("tenant_id", input.tenantId)
      .eq("student_id", input.studentId)
      .eq("service_date", input.serviceDate)
      .eq("meal_slot", input.mealSlot)
      .is("reversed_at", null)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new Error(
        `attendance conflict but live row unreadable: ${fetchError?.message ?? "not found"}`,
      );
    }

    return { created: false, existing: toRecord(existing) };
  }

  async findForStudentMeal(
    tenantId: string,
    studentId: string,
    serviceDate: ServiceDate,
    mealSlot: MealSlot,
  ): Promise<AttendanceRecord | null> {
    // Hits the same unique key the write relies on, so this is an index lookup
    // on the scan path's budget.
    const { data, error } = await this.db
      .from("attendance")
      .select("id, student_id, service_date, meal_slot, scanned_at, method")
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .eq("service_date", serviceDate)
      .eq("meal_slot", mealSlot)
      // A reversed meal was recorded in error, so the student has not eaten.
      .is("reversed_at", null)
      .maybeSingle();

    if (error) throw new Error(`attendance lookup failed: ${error.message}`);
    if (!data) return null;

    return {
      id: data.id,
      studentId: data.student_id,
      serviceDate: toServiceDate(data.service_date),
      mealSlot: data.meal_slot,
      scannedAt: new Date(data.scanned_at),
      method: data.method,
    };
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
      .eq("meal_slot", mealSlot)
      // A reversed meal never happened, so it must not inflate the count the
      // kitchen is measured against.
      .is("reversed_at", null);

    if (error) throw new Error(`attendance count failed: ${error.message}`);
    return count ?? 0;
  }
}
