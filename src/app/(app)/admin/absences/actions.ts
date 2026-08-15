"use server";

/**
 * Approving or rejecting a student's away request.
 *
 * Audit-logged without exception. "Why was I marked absent for a week I was
 * here?" is only answerable if the decision carries who made it and when — and
 * an approved absence removes plates from a headcount the kitchen cooks to.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { decideAbsence } from "@/core/policies/decide-absence.policy";
import { toServiceDate } from "@/core/time";
import { getSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";
import { todayIn } from "@/lib/format";

export interface DecisionActionState {
  readonly error?: string;
  readonly success?: string;
}

const schema = z.object({
  id: z.string().uuid(),
  outcome: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().max(500).optional(),
});

export async function decideAbsenceRequest(
  _prev: DecisionActionState,
  formData: FormData,
): Promise<DecisionActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  const parsed = schema.safeParse({
    id: formData.get("id"),
    outcome: formData.get("outcome"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return { error: "That decision could not be read. Try again." };

  const admin = createAdminClient();

  // Read first: the policy needs the current status and the dates, and neither
  // may come from the form — a stale page would otherwise let an admin decide
  // a request the student withdrew ten minutes ago.
  const { data: row } = await admin
    .from("mess_cuts")
    .select("id, status, date_from, date_to, student_id")
    .eq("tenant_id", user.tenantId)
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (!row) return { error: "That request no longer exists." };

  const decision = decideAbsence({
    actorRole: user.role,
    currentStatus: row.status,
    outcome: parsed.data.outcome,
    reason: parsed.data.reason ?? "",
    dateFrom: toServiceDate(row.date_from),
    dateTo: toServiceDate(row.date_to),
    today: todayIn(user.timezone),
  });
  if (!decision.ok) return { error: decision.error.message };

  // Scoped by status as well as id: two admins deciding the same request at
  // once means the second write matches no rows rather than overwriting the
  // first decision.
  const { data: updated, error } = await admin
    .from("mess_cuts")
    .update({
      status: decision.value.status,
      rejection_reason: decision.value.reason,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", user.tenantId)
    .eq("id", row.id)
    .eq("status", "PENDING")
    .select("id")
    .maybeSingle();

  if (error) return { error: `Could not save: ${error.message}` };
  if (!updated) {
    return { error: "Someone else decided this request first. Reload to see where it stands." };
  }

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "MESS_CUT_DECIDED",
    entityType: "mess_cuts",
    entityId: row.id,
    before: { status: decision.value.from },
    after: {
      status: decision.value.to,
      reason: decision.value.reason,
      studentId: row.student_id,
      dateFrom: row.date_from,
      dateTo: row.date_to,
    },
  });

  // An approved absence changes what the kitchen cooks.
  revalidatePath("/admin/absences");
  revalidatePath("/admin/headcount");
  revalidatePath("/student/absences");

  return {
    success:
      decision.value.status === "APPROVED"
        ? "Approved. Those meals are off the headcount."
        : "Rejected. The student can see your reason.",
  };
}
