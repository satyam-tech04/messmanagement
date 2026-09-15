"use server";

/**
 * Entering and leaving a student's account as the platform operator.
 *
 * Rule 2 shape: validate, build the context, call one use case, map the result.
 * Whether the operator may enter is `beginStudentImpersonation`'s decision; the
 * session swap is this layer's job for the same reason the mess switcher's
 * token refresh is — it is cookies, not business rules.
 *
 * Both directions are written to the audit trail of the mess involved. The
 * question it has to answer is the one a mess owner will ask: "who was inside
 * Asha's account on Tuesday, and when did they leave?"
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { beginStudentImpersonation } from "@/core/services/begin-impersonation";
import { getSessionUser } from "@/infra/auth/session";
import {
  readImpersonation,
  restoreOperatorSession,
  swapIntoStudentSession,
} from "@/infra/auth/impersonation";
import { createClient } from "@/infra/supabase/server";
import { createAdminClient } from "@/infra/supabase/admin";
import {
  SupabaseAuditLogRepository,
  SupabaseImpersonationDirectory,
} from "@/infra/supabase/repositories";

export interface EnterAsStudentState {
  readonly error?: string;
}

const schema = z.object({ profileId: z.string().uuid("Choose a student from the list.") });

export async function enterAsStudent(
  _prev: EnterAsStudentState,
  formData: FormData,
): Promise<EnterAsStudentState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  const parsed = schema.safeParse({ profileId: formData.get("profileId") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Choose a student." };

  const admin = createAdminClient();
  const directory = new SupabaseImpersonationDirectory(admin);

  const decision = await beginStudentImpersonation(user, parsed.data.profileId, { directory });
  if (!decision.ok) return { error: decision.error.message };
  const student = decision.value;

  let email: string | null;
  try {
    email = await directory.authEmailOf(student.profileId);
  } catch {
    email = null;
  }
  if (!email) return { error: `${student.fullName}'s sign-in could not be read. Try again.` };

  const requestHeaders = await headers();
  const audit = new SupabaseAuditLogRepository(admin);

  // Recorded before the swap, while the actor is unambiguously the operator. A
  // swap that then fails leaves an entry with a matching failure note below,
  // which is the honest record.
  await audit.write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "IMPERSONATION_START",
    entityType: "profile",
    entityId: student.profileId,
    before: null,
    after: { studentName: student.fullName, rollNumber: student.rollNumber },
    ip: requestHeaders.get("x-forwarded-for"),
    userAgent: requestHeaders.get("user-agent"),
  });

  const supabase = await createClient();
  const swap = await swapIntoStudentSession(supabase, admin, {
    operatorProfileId: user.actorProfileId,
    studentProfileId: student.profileId,
    studentEmail: email,
    tenantId: user.tenantId,
  });

  if (!swap.ok) {
    await audit.write({
      tenantId: user.tenantId,
      actorProfileId: user.actorProfileId,
      action: "IMPERSONATION_FAILED",
      entityType: "profile",
      entityId: student.profileId,
      before: null,
      after: { reason: swap.reason },
      ip: requestHeaders.get("x-forwarded-for"),
      userAgent: requestHeaders.get("user-agent"),
    });
    return {
      error:
        swap.reason === "NO_OPERATOR_SESSION"
          ? "Your session could not be read. Sign in again and retry."
          : `Could not enter ${student.fullName}'s account. You are still signed in as yourself.`,
    };
  }

  revalidatePath("/", "layout");
  redirect("/student");
}

/** The banner's Exit button. Returns the operator to their own account. */
export async function exitImpersonation(): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const marker = await readImpersonation(user.actorProfileId);
  const supabase = await createClient();

  if (!marker) {
    // No valid marker means there is no operator to return to — the safe end
    // is simply signing this session out.
    await supabase.auth.signOut({ scope: "local" });
    redirect("/login");
  }

  const restored = await restoreOperatorSession(supabase, marker);

  const requestHeaders = await headers();
  await new SupabaseAuditLogRepository(createAdminClient()).write({
    tenantId: marker.tenantId,
    actorProfileId: marker.operatorProfileId,
    action: "IMPERSONATION_END",
    entityType: "profile",
    entityId: marker.studentProfileId,
    before: null,
    after: { restored: restored.ok },
    ip: requestHeaders.get("x-forwarded-for"),
    userAgent: requestHeaders.get("user-agent"),
  });

  revalidatePath("/", "layout");
  // A lost way back is not an error worth a dead end: the operator signs in.
  redirect(restored.ok ? "/superuser" : "/login");
}
