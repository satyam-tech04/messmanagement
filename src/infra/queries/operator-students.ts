/**
 * The students the operator may enter as, for the persona picker.
 *
 * Read with the operator's own session client, so RLS confines it to the one
 * mess they are in — exactly what the mess's admin could see on /admin/students.
 * No service role here: the list needs no auth addresses, only names.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudentStatus } from "@/core/domain/enums";
import type { Database } from "@/infra/supabase/database.types";
import { firstRelated } from "@/infra/supabase/mappers";

export interface OperatorStudentRow {
  readonly profileId: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly room: string | null;
  readonly status: StudentStatus;
  readonly accountEnabled: boolean;
}

export interface OperatorStudentList {
  readonly rows: readonly OperatorStudentRow[];
  readonly total: number;
}

export const OPERATOR_STUDENT_LIMIT = 30;

export async function readOperatorStudents(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  search: string,
): Promise<OperatorStudentList> {
  const term = search.trim().replace(/[,()%]/g, "");

  // Name is on profiles, roll number on students; PostgREST cannot OR across
  // the two in one filter, so resolve matching names first (the same approach
  // as the admin students list).
  let nameMatches: string[] = [];
  if (term) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("role", "STUDENT")
      .ilike("full_name", `%${term}%`)
      .limit(200);
    if (error) throw new Error(`student name search failed: ${error.message}`);
    nameMatches = (data ?? []).map((p) => p.id);
  }

  let query = supabase
    .from("students")
    .select(
      `profile_id, roll_number, block, room_number, status,
       profiles!inner ( full_name, status )`,
      { count: "exact" },
    )
    .eq("tenant_id", tenantId);

  if (term) {
    const clauses = [`roll_number.ilike.%${term}%`];
    if (nameMatches.length > 0) clauses.push(`profile_id.in.(${nameMatches.join(",")})`);
    query = query.or(clauses.join(","));
  }

  const { data, count, error } = await query
    .order("roll_number", { ascending: true })
    .limit(OPERATOR_STUDENT_LIMIT);

  if (error) throw new Error(`student list failed: ${error.message}`);

  const rows = (data ?? []).map((row) => {
    const profile = firstRelated<{ full_name: string; status: string }>(row.profiles as never);
    const room = [row.block, row.room_number].filter(Boolean).join("-");
    return {
      profileId: row.profile_id,
      fullName: profile?.full_name ?? "Unnamed student",
      rollNumber: row.roll_number,
      room: room || null,
      status: row.status as StudentStatus,
      accountEnabled: profile?.status === "ACTIVE",
    };
  });

  return { rows, total: count ?? rows.length };
}
