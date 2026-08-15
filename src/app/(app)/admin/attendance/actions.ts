"use server";

/**
 * Correcting a mistaken scan.
 *
 * Staff serve the wrong student — a mistyped roll number, the wrong person
 * waved through — and until now the row was permanent: the headcount stayed
 * wrong and, in Phase 2, that student would be billed for a meal they never ate.
 *
 * Nothing is deleted (rule 4). The row is marked reversed, with who did it and
 * why, so the original scan and its correction are both permanently visible.
 * Because the uniqueness index covers live rows only, reversing also frees the
 * student to be served — which matters, since a meal recorded in error means
 * they have not eaten.
 *
 * Admin-only. Letting the counter reverse its own scans would make the audit
 * trail describe a decision reviewed by nobody.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/infra/supabase/admin";
import { getSessionUser } from "@/infra/auth/session";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";

export interface ReversalState {
  readonly error?: string;
  readonly success?: string;
}

const schema = z.object({
  attendanceId: z.string().uuid("Malformed attendance reference."),
  reason: z.string().trim().min(3, "Give a reason for the correction").max(500),
});

export async function reverseAttendance(
  _prev: ReversalState,
  formData: FormData,
): Promise<ReversalState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { error: "Only an admin can correct attendance." };
  }

  const parsed = schema.safeParse({
    attendanceId: formData.get("attendanceId"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const admin = createAdminClient();

  const { data: row } = await admin
    .from("attendance")
    .select("id, student_id, service_date, meal_slot, method, scanned_at, reversed_at")
    .eq("id", parsed.data.attendanceId)
    // Tenant filter is the boundary here: the service-role client bypasses RLS.
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  if (!row) return { error: "That attendance record does not exist in this mess." };
  if (row.reversed_at) return { error: "That record has already been corrected." };

  const { error, count } = await admin
    .from("attendance")
    .update(
      {
        reversed_at: new Date().toISOString(),
        reversed_by: user.actorProfileId,
        reversal_reason: parsed.data.reason,
      },
      { count: "exact" },
    )
    .eq("id", row.id)
    .eq("tenant_id", user.tenantId)
    // Optimistic: if another admin reversed it since this page rendered, this
    // matches nothing rather than overwriting their reason with a second one.
    .is("reversed_at", null);

  if (error) return { error: `Could not correct the record: ${error.message}` };
  if (count === 0) return { error: "That record was corrected by someone else. Reload the page." };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "ATTENDANCE_REVERSED",
    entityType: "attendance",
    entityId: row.id,
    before: {
      studentId: row.student_id,
      serviceDate: row.service_date,
      mealSlot: row.meal_slot,
      method: row.method,
      scannedAt: row.scanned_at,
    },
    after: { reversed: true, reason: parsed.data.reason },
  });

  // The count the kitchen sees, and the student's own screen, both change.
  revalidatePath("/admin/attendance");
  revalidatePath("/admin/headcount");
  revalidatePath(`/admin/students/${row.student_id}`);
  revalidatePath("/staff/counts");
  revalidatePath("/student");

  return {
    success: "Corrected. The meal no longer counts, and the student can be served again.",
  };
}
