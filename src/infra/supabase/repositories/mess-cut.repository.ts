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
import type { AbsenceRow, CreateAbsenceInput, MessCutRepository } from "@/core/ports/repositories";
import { toServiceDate, type ServiceDate } from "@/core/time";
import type { Database } from "../database.types";

type Row = Database["public"]["Tables"]["mess_cuts"]["Row"];

const ACTIVE_STATUSES = ["APPROVED", "CREDITED"] as const;

/**
 * Statuses that still consume the monthly allowance.
 *
 * Wider than ACTIVE_STATUSES by PENDING: a request awaiting review has not been
 * granted, but it HAS been asked for. Leaving it out would let a student spend
 * the same five days repeatedly while the admin is deciding.
 */
const LIVE_STATUSES = ["PENDING", "APPROVED", "CREDITED"] as const;

function toRow(row: Row): AbsenceRow {
  return {
    id: row.id,
    studentId: row.student_id,
    dateFrom: toServiceDate(row.date_from),
    dateTo: toServiceDate(row.date_to),
    mealSlots: row.meal_slots,
    status: row.status,
    requestedAt: new Date(row.requested_at),
    rejectionReason: row.rejection_reason,
  };
}

/**
 * First and last day of the calendar month containing `date`.
 *
 * Built by string, not by `Date`: a `Date` would carry a UTC instant and shift
 * the boundary for an IST hostel (rule 9). `date` is already tenant-local.
 */
function monthBounds(date: ServiceDate): [string, string] {
  const [year, month] = date.split("-").map(Number);
  // Day 0 of the next month is the last day of this one, and this arithmetic is
  // on a plain calendar with no timezone involved.
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return [`${year}-${mm}-01`, `${year}-${mm}-${String(lastDay).padStart(2, "0")}`];
}

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

  async findLiveInMonth(
    tenantId: string,
    studentId: string,
    reference: ServiceDate,
  ): Promise<AbsenceRow[]> {
    const [first, last] = monthBounds(reference);

    const { data, error } = await this.db
      .from("mess_cuts")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      // Overlap, not containment: a cut running 28 Feb–3 Mar spends days in two
      // months, and the caller needs the whole row to work out how many are in
      // this one.
      .lte("date_from", last)
      .gte("date_to", first)
      .in("status", LIVE_STATUSES);

    if (error) throw new Error(`month absence lookup failed: ${error.message}`);
    return (data ?? []).map(toRow);
  }

  async create(input: CreateAbsenceInput): Promise<AbsenceRow> {
    // A plain INSERT, deliberately. `ON CONFLICT` cannot infer a *partial*
    // unique index — Postgres raises 42P10 — and
    // `mess_cuts_one_live_request_idx` is partial on status. The caller catches
    // 23505 and re-reads, which is the same guarantee with the error handled
    // one level up. (Learned the hard way on `attendance`.)
    const { data, error } = await this.db
      .from("mess_cuts")
      .insert({
        tenant_id: input.tenantId,
        student_id: input.studentId,
        subscription_id: input.subscriptionId,
        date_from: input.dateFrom,
        date_to: input.dateTo,
        meal_slots: [...input.mealSlots],
        status: input.status,
        effective_from: input.effectiveFrom.toISOString(),
      })
      .select("*")
      .single();

    if (error) {
      // Rethrown with the code intact so the use case can tell a retry from a
      // real failure. A bare `new Error(message)` would lose that.
      throw Object.assign(new Error(`absence write failed: ${error.message}`), {
        code: error.code,
      });
    }
    return toRow(data);
  }

  async cancel(tenantId: string, studentId: string, id: string): Promise<AbsenceRow | null> {
    // `student_id` is in the WHERE clause, not merely checked beforehand: it is
    // what stops one student cancelling another's absence by guessing an id.
    // Only a request that has not been acted on can be withdrawn — a REJECTED
    // one is the admin's decision, and a CREDITED one has money attached.
    const { data, error } = await this.db
      .from("mess_cuts")
      .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .eq("id", id)
      .in("status", ["PENDING", "APPROVED"])
      .select("*")
      .maybeSingle();

    if (error) throw new Error(`absence cancel failed: ${error.message}`);
    return data ? toRow(data) : null;
  }

  async findForStudent(tenantId: string, studentId: string, limit: number): Promise<AbsenceRow[]> {
    const { data, error } = await this.db
      .from("mess_cuts")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .order("date_from", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`absence history lookup failed: ${error.message}`);
    return (data ?? []).map(toRow);
  }
}
