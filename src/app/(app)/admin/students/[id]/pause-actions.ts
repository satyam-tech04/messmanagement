"use server";

/**
 * Pausing a student's subscription — the admin-facing "grace period".
 *
 * Same shape as every other action here: authenticate, validate with Zod, call
 * one decision function, map the result. Every rule about dates, eligibility
 * and the end date lives in `src/core/policies/pause.policy.ts` (rule 2).
 *
 * Two things these actions must get right that the policy cannot:
 *
 *   1. The pause row and `subscriptions.end_date` have to move together. They
 *      are written in that order so a failure between them leaves a pause with
 *      no extension — visible and fixable — rather than an extension with no
 *      pause, which nothing would ever explain.
 *
 *   2. Spec §14 forbids overlapping pauses and says to modify the existing one
 *      instead. The database enforces that with an exclusion constraint; these
 *      actions find the existing row first so the admin gets a sentence rather
 *      than a constraint violation.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  cancelPause,
  parsePauseDraft,
  pauseStateOf,
  resumePauseEarly,
} from "@/core/policies/pause.policy";
import { serviceDateOf, toServiceDate, type ServiceDate } from "@/core/time";
import { createAdminClient } from "@/infra/supabase/admin";
import { getSessionUser } from "@/infra/auth/session";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";
import type { ActionState } from "./actions";

const dateField = (label: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `Enter a valid ${label}.`);

/**
 * Loads the student, their running subscription, and any live pause on it.
 *
 * The service-role client bypasses RLS, so the tenant filters below *are* the
 * tenant boundary for these actions (rule 8).
 */
async function loadPauseContext(studentId: string) {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." as const };
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { error: "Only an admin can pause a subscription." as const };
  }
  if (!z.string().uuid().safeParse(studentId).success) {
    return { error: "Student not found." as const };
  }

  const admin = createAdminClient();
  const { data: student } = await admin
    .from("students")
    .select("id, tenant_id, roll_number")
    .eq("id", studentId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!student) return { error: "Student not found." as const };

  const { data: subscription } = await admin
    .from("subscriptions")
    .select("id, status, start_date, end_date")
    .eq("tenant_id", user.tenantId)
    .eq("student_id", student.id)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (!subscription) {
    return { error: "This student has no plan to pause." as const };
  }

  // Cancelled pauses are excluded here for the same reason the exclusion
  // constraint excludes them: a cancelled pause frees its dates, so it must not
  // be treated as the one to modify (§23).
  const { data: pause } = await admin
    .from("subscription_pauses")
    .select("id, status, start_date, resume_date, end_date_before_pause, remarks")
    .eq("tenant_id", user.tenantId)
    .eq("subscription_id", subscription.id)
    .eq("status", "ACTIVE")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const today = serviceDateOf(user.timezone, new Date());

  return { user, admin, student, subscription, pause: pause ?? null, today };
}

/** Moves the subscription's end date, guarding against a lost update. */
async function moveEndDate(
  admin: ReturnType<typeof createAdminClient>,
  args: { tenantId: string; subscriptionId: string; to: ServiceDate },
): Promise<string | null> {
  const { error, count } = await admin
    .from("subscriptions")
    .update({ end_date: args.to }, { count: "exact" })
    .eq("id", args.subscriptionId)
    .eq("tenant_id", args.tenantId)
    // Only a still-active subscription may be extended. If it was cancelled in
    // another tab while this form was open, the update matches nothing rather
    // than resurrecting a dead plan's dates.
    .eq("status", "ACTIVE");

  if (error) return error.message;
  if (count === 0) return "That plan is no longer active. Reload the page.";
  return null;
}

// --- Create or modify ------------------------------------------------------

const pauseSchema = z.object({
  startDate: dateField("start date"),
  resumeDate: dateField("resume date"),
  subscriptionEndDate: dateField("subscription end date").optional().or(z.literal("")),
  remarks: z.string().trim().min(3, "Give a reason for the pause.").max(500),
});

/**
 * Creates a pause, or updates the one that already exists (§14, AC11, AC16).
 *
 * One action rather than two because the admin's intent is identical and the
 * spec is explicit that a second overlapping pause must never be created. The
 * only difference is which anchor is used, and that is decided by whether a row
 * was found — never by the form.
 */
export async function savePause(
  studentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const loaded = await loadPauseContext(studentId);
  if ("error" in loaded) return { error: loaded.error };
  const { user, admin, student, subscription, pause, today } = loaded;

  const parsed = pauseSchema.safeParse({
    startDate: formData.get("startDate"),
    resumeDate: formData.get("resumeDate"),
    subscriptionEndDate: formData.get("subscriptionEndDate") ?? "",
    remarks: formData.get("remarks") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const decision = parsePauseDraft({
    actorRole: user.role,
    subscription: {
      status: subscription.status,
      startDate: toServiceDate(subscription.start_date),
      endDate: toServiceDate(subscription.end_date),
    },
    startDate: toServiceDate(parsed.data.startDate),
    resumeDate: toServiceDate(parsed.data.resumeDate),
    today,
    remarks: parsed.data.remarks,
    ...(parsed.data.subscriptionEndDate
      ? { subscriptionEndDate: toServiceDate(parsed.data.subscriptionEndDate) }
      : {}),
    // The anchor. On a modify it comes from the existing row, never from the
    // subscription's current end date — that is what stops four edits
    // extending the plan four times (§22).
    ...(pause ? { endDateBeforePause: toServiceDate(pause.end_date_before_pause) } : {}),
  });
  if (!decision.ok) return { error: decision.error.message };
  const draft = decision.value;

  const row = {
    tenant_id: user.tenantId,
    subscription_id: subscription.id,
    student_id: student.id,
    start_date: draft.startDate,
    resume_date: draft.resumeDate,
    end_date_before_pause: draft.endDateBeforePause,
    computed_end_date: draft.computedEndDate,
    remarks: draft.remarks,
    status: "ACTIVE" as const,
  };

  const written = pause
    ? await admin.from("subscription_pauses").update(row).eq("id", pause.id).select("id").single()
    : await admin
        .from("subscription_pauses")
        .insert({ ...row, created_by: user.actorProfileId })
        .select("id")
        .single();

  if (written.error) {
    // 23P01 is the exclusion constraint: another pause already covers these
    // dates. Reached only in a race, since the read above would normally have
    // found it — but the constraint is the real guarantee (rule 5).
    if (written.error.code === "23P01") {
      return { error: "Another pause already covers those dates. Reload the page." };
    }
    return { error: `Could not save the pause: ${written.error.message}` };
  }

  const moveError = await moveEndDate(admin, {
    tenantId: user.tenantId,
    subscriptionId: subscription.id,
    to: draft.subscriptionEndDate,
  });
  if (moveError)
    return { error: `The pause was saved, but the end date did not move: ${moveError}` };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: pause ? "SUBSCRIPTION_PAUSE_UPDATED" : "SUBSCRIPTION_PAUSE_CREATED",
    entityType: "subscription_pause",
    entityId: written.data.id,
    ...(pause
      ? {
          before: {
            startDate: pause.start_date,
            resumeDate: pause.resume_date,
            endDate: subscription.end_date,
          },
        }
      : {}),
    after: {
      studentId: student.id,
      startDate: draft.startDate,
      resumeDate: draft.resumeDate,
      graceDays: draft.graceDays,
      computedEndDate: draft.computedEndDate,
      endDate: draft.subscriptionEndDate,
      endDateOverridden: draft.isEndDateOverridden,
      remarks: draft.remarks,
    },
  });

  revalidatePath(`/admin/students/${student.id}`);
  revalidatePath("/admin/students");

  const days = draft.graceDays === 1 ? "1 day" : `${draft.graceDays} days`;
  return {
    success: pause
      ? `Pause updated. ${days} paused; the plan now ends ${draft.subscriptionEndDate}.`
      : `Pause saved. ${days} paused; the plan now ends ${draft.subscriptionEndDate}.`,
  };
}

// --- Resume early ----------------------------------------------------------

const resumeSchema = z.object({ resumeOn: dateField("resume date") });

/**
 * Ends a running pause before its scheduled resume date (§16, AC14).
 *
 * The subscription is credited with the days *actually* paused, never the days
 * originally scheduled — unused future days must not keep extending the plan.
 * Rewriting `resume_date` is what makes that fall out automatically: the
 * derived state, the grace-day count and the extension all read from it.
 */
export async function resumeEarly(
  studentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const loaded = await loadPauseContext(studentId);
  if ("error" in loaded) return { error: loaded.error };
  const { user, admin, student, subscription, pause, today } = loaded;

  if (!pause) return { error: "There is no pause to resume." };

  const parsed = resumeSchema.safeParse({ resumeOn: formData.get("resumeOn") ?? today });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const decision = resumePauseEarly({
    actorRole: user.role,
    pause: {
      status: pause.status,
      startDate: toServiceDate(pause.start_date),
      resumeDate: toServiceDate(pause.resume_date),
      endDateBeforePause: toServiceDate(pause.end_date_before_pause),
    },
    resumeOn: toServiceDate(parsed.data.resumeOn),
    today,
  });
  if (!decision.ok) return { error: decision.error.message };
  const resumed = decision.value;

  const { error: updateError } = await admin
    .from("subscription_pauses")
    .update({
      resume_date: resumed.resumeDate,
      ended_early_at: new Date().toISOString(),
    })
    .eq("id", pause.id)
    .eq("tenant_id", user.tenantId);
  if (updateError) return { error: `Could not resume the pause: ${updateError.message}` };

  const moveError = await moveEndDate(admin, {
    tenantId: user.tenantId,
    subscriptionId: subscription.id,
    to: resumed.subscriptionEndDate,
  });
  if (moveError) return { error: `Resumed, but the end date did not move: ${moveError}` };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "SUBSCRIPTION_PAUSE_RESUMED_EARLY",
    entityType: "subscription_pause",
    entityId: pause.id,
    before: { resumeDate: pause.resume_date, endDate: subscription.end_date },
    after: {
      resumeDate: resumed.resumeDate,
      graceDays: resumed.graceDays,
      endDate: resumed.subscriptionEndDate,
    },
  });

  revalidatePath(`/admin/students/${student.id}`);
  return {
    success: `Resumed. ${resumed.graceDays === 1 ? "1 day was" : `${resumed.graceDays} days were`} paused; the plan now ends ${resumed.subscriptionEndDate}.`,
  };
}

// --- Cancel ----------------------------------------------------------------

/**
 * Cancels a pause that has not started yet (§17, AC13).
 *
 * The subscription's end date is restored to the anchor exactly — "no
 * subscription extension is applied because of the cancelled Grace Period."
 * A pause already running cannot be cancelled; that is what resume-early is for.
 */
export async function cancelScheduledPause(
  studentId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const loaded = await loadPauseContext(studentId);
  if ("error" in loaded) return { error: loaded.error };
  const { user, admin, student, subscription, pause, today } = loaded;

  if (!pause) return { error: "There is no pause to cancel." };

  const decision = cancelPause({
    actorRole: user.role,
    pause: {
      status: pause.status,
      startDate: toServiceDate(pause.start_date),
      resumeDate: toServiceDate(pause.resume_date),
      endDateBeforePause: toServiceDate(pause.end_date_before_pause),
    },
    today,
  });
  if (!decision.ok) {
    return {
      error:
        pauseStateOf(
          {
            status: pause.status,
            startDate: toServiceDate(pause.start_date),
            resumeDate: toServiceDate(pause.resume_date),
          },
          today,
        ) === "RUNNING"
          ? "This pause has already started. Resume it early instead of cancelling it."
          : decision.error.message,
    };
  }

  const { error: updateError, count } = await admin
    .from("subscription_pauses")
    .update({ status: "CANCELLED" }, { count: "exact" })
    .eq("id", pause.id)
    .eq("tenant_id", user.tenantId)
    .eq("status", "ACTIVE");
  if (updateError) return { error: `Could not cancel the pause: ${updateError.message}` };
  if (count === 0) return { error: "That pause is no longer active. Reload the page." };

  const moveError = await moveEndDate(admin, {
    tenantId: user.tenantId,
    subscriptionId: subscription.id,
    to: decision.value.subscriptionEndDate,
  });
  if (moveError) return { error: `Cancelled, but the end date did not move back: ${moveError}` };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "SUBSCRIPTION_PAUSE_CANCELLED",
    entityType: "subscription_pause",
    entityId: pause.id,
    before: { status: "ACTIVE", endDate: subscription.end_date },
    after: { status: "CANCELLED", endDate: decision.value.subscriptionEndDate },
  });

  revalidatePath(`/admin/students/${student.id}`);
  return { success: "Pause cancelled. The plan is unchanged." };
}
