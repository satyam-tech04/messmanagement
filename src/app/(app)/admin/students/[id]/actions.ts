"use server";

/**
 * Student detail mutations.
 *
 * Each action does the same four things and nothing more: authenticate, validate
 * with Zod, call one decision function, map the result. The decisions themselves
 * — who may change a status, which transitions are legal — live in
 * `src/core/policies/student-admin.policy.ts` (rule 2).
 *
 * Every mutation here writes to `audit_log`. Editing a student's details,
 * blocking them, or resetting their password are precisely the actions that get
 * disputed weeks later, and the log is the only answer.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { MealSlot, StudentStatus } from "@/core/domain/enums";
import { toPaise } from "@/core/money";
import { activateSubscription, canDeleteScheduledSubscription } from "@/core/policies/plan.policy";
import { changeStudentStatus } from "@/core/policies/student-admin.policy";
import { serviceDateOf, toServiceDate } from "@/core/time";
import { createAdminClient } from "@/infra/supabase/admin";
import { getSessionUser } from "@/infra/auth/session";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";
import { generateTemporaryPassword } from "@/lib/password";

export interface ActionState {
  readonly error?: string;
  readonly fieldErrors?: Record<string, string>;
  readonly success?: string;
  /** Only ever set by resetPassword, and shown exactly once. */
  readonly temporaryPassword?: string;
}

const idSchema = z.string().uuid("Malformed student reference.");

/**
 * Loads a student and proves it belongs to the caller's tenant.
 *
 * The service-role client bypasses RLS, so this check *is* the tenant boundary
 * for these actions — without it, a guessed UUID from another hostel would be
 * editable (rule 8).
 */
async function loadOwnedStudent(studentId: string) {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." as const };
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { error: "Only an admin can change student records." as const };
  }

  const parsedId = idSchema.safeParse(studentId);
  if (!parsedId.success) return { error: "Student not found." as const };

  const admin = createAdminClient();
  const { data: student, error } = await admin
    .from("students")
    .select("id, tenant_id, profile_id, roll_number, status, block, room_number")
    .eq("id", parsedId.data)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  if (error) return { error: `Could not load the student: ${error.message}` as const };
  // Same message whether it does not exist or belongs to another mess — a
  // distinct "wrong tenant" error would confirm the id is real.
  if (!student) return { error: "Student not found." as const };

  return { user, admin, student };
}

// --- Edit details ---------------------------------------------------------

const detailsSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the student's full name").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, "Enter a valid phone number")
    .optional()
    .or(z.literal("")),
  email: z.email("Enter a valid email").optional().or(z.literal("")),
  block: z.string().trim().max(40).optional().or(z.literal("")),
  roomNumber: z.string().trim().max(40).optional().or(z.literal("")),
});

export async function updateStudentDetails(
  studentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const loaded = await loadOwnedStudent(studentId);
  if ("error" in loaded) return { error: loaded.error };
  const { user, admin, student } = loaded;

  const parsed = detailsSchema.safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    block: formData.get("block") ?? "",
    roomNumber: formData.get("roomNumber") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }

  const input = parsed.data;

  // Captured before the write so the audit entry can show what actually changed.
  const { data: before } = await admin
    .from("profiles")
    .select("full_name, phone, email")
    .eq("id", student.profile_id)
    .maybeSingle();

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      full_name: input.fullName,
      phone: input.phone || null,
      email: input.email || null,
    })
    .eq("id", student.profile_id)
    .eq("tenant_id", user.tenantId);

  if (profileError) return { error: `Could not save: ${profileError.message}` };

  const { error: studentError } = await admin
    .from("students")
    .update({ block: input.block || null, room_number: input.roomNumber || null })
    .eq("id", student.id)
    .eq("tenant_id", user.tenantId);

  if (studentError) return { error: `Could not save: ${studentError.message}` };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "STUDENT_UPDATED",
    entityType: "student",
    entityId: student.id,
    before: {
      fullName: before?.full_name ?? null,
      phone: before?.phone ?? null,
      email: before?.email ?? null,
      block: student.block,
      roomNumber: student.room_number,
    },
    after: {
      fullName: input.fullName,
      phone: input.phone || null,
      email: input.email || null,
      block: input.block || null,
      roomNumber: input.roomNumber || null,
    },
  });

  revalidatePath(`/admin/students/${student.id}`);
  revalidatePath("/admin/students");

  return { success: "Details saved." };
}

// --- Change status --------------------------------------------------------

const statusSchema = z.object({
  status: z.enum(["ACTIVE", "GRACE", "BLOCKED", "INACTIVE"]),
  reason: z.string().trim().min(3, "Give a reason for this change").max(500),
});

export async function updateStudentStatus(
  studentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const loaded = await loadOwnedStudent(studentId);
  if ("error" in loaded) return { error: loaded.error };
  const { user, admin, student } = loaded;

  const parsed = statusSchema.safeParse({
    status: formData.get("status"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  // The decision — authorization, legal transition, mandatory reason — is made
  // once, in core, where it is unit-tested. This action only maps the result.
  const decision = changeStudentStatus({
    actorRole: user.role,
    current: student.status as StudentStatus,
    next: parsed.data.status,
    reason: parsed.data.reason,
  });

  if (!decision.ok) return { error: decision.error.message };
  const change = decision.value;

  const { error: updateError } = await admin
    .from("students")
    .update({ status: change.to })
    .eq("id", student.id)
    .eq("tenant_id", user.tenantId)
    // Optimistic concurrency: if another admin changed the status since this
    // page rendered, this matches zero rows rather than overwriting their
    // decision with one made against stale information.
    .eq("status", change.from);

  if (updateError) return { error: `Could not change the status: ${updateError.message}` };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "STUDENT_STATUS_CHANGED",
    entityType: "student",
    entityId: student.id,
    before: { status: change.from },
    after: { status: change.to, reason: change.reason },
  });

  revalidatePath(`/admin/students/${student.id}`);
  revalidatePath("/admin/students");

  return { success: `Status changed to ${change.to.toLowerCase()}.` };
}

// --- Reset password -------------------------------------------------------

export async function resetStudentPassword(
  studentId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const loaded = await loadOwnedStudent(studentId);
  if ("error" in loaded) return { error: loaded.error };
  const { user, admin, student } = loaded;

  const temporaryPassword = generateTemporaryPassword();

  const { error: authError } = await admin.auth.admin.updateUserById(student.profile_id, {
    password: temporaryPassword,
  });
  if (authError) return { error: `Could not reset the password: ${authError.message}` };

  // The admin now knows this password, so the account is not genuinely the
  // student's again until they choose their own.
  const { error: flagError } = await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", student.profile_id)
    .eq("tenant_id", user.tenantId);

  if (flagError) {
    // The password already changed, so this cannot be rolled back silently —
    // say so plainly rather than reporting a clean success.
    return {
      error:
        "The password was reset, but the forced-change flag could not be set. Tell the student to change it manually.",
      temporaryPassword,
    };
  }

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "STUDENT_PASSWORD_RESET",
    entityType: "student",
    entityId: student.id,
    // Never the password itself, not even hashed — an audit log is read by more
    // people than a credential ever should be.
    after: { rollNumber: student.roll_number },
  });

  revalidatePath(`/admin/students/${student.id}`);

  return { success: "Password reset.", temporaryPassword };
}

// --- Assign a plan --------------------------------------------------------

const assignSchema = z.object({
  planId: z.string().uuid("Choose a plan."),
  // Blank means the plan's own term — the ordinary case, and not an error.
  assignmentDurationDays: z.string().trim(),
  // Blank means "charge the calculated price". Kept as a string so that an
  // empty field is distinguishable from a deliberate zero.
  overrideRupees: z.string().trim(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid start date")
    .optional()
    .or(z.literal("")),
});

export async function assignPlan(
  studentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const loaded = await loadOwnedStudent(studentId);
  if ("error" in loaded) return { error: loaded.error };
  const { user, admin, student } = loaded;

  const parsed = assignSchema.safeParse({
    planId: formData.get("planId"),
    assignmentDurationDays: formData.get("assignmentDurationDays") ?? "",
    overrideRupees: formData.get("overrideRupees") ?? "",
    startDate: formData.get("startDate") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { data: plan } = await admin
    .from("plans")
    .select("id, is_active, price_paise, duration_days, included_meal_slots")
    .eq("id", parsed.data.planId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  if (!plan) return { error: "That plan does not exist in this mess." };

  // Every subscription this student holds, so the policy can refuse an overlap
  // and name the first free date. Replaces an older dance that retired the
  // previous plan to EXPIRED purely to free a one-active-per-student index —
  // that index is gone (migration 017), and marking a plan finished as a side
  // effect of assigning another was never honest.
  const { data: existingRows } = await admin
    .from("subscriptions")
    .select("status, start_date, end_date")
    .eq("tenant_id", user.tenantId)
    .eq("student_id", student.id);

  const existingPeriods = (existingRows ?? []).map((row) => ({
    status: row.status,
    startDate: toServiceDate(row.start_date),
    endDate: toServiceDate(row.end_date),
  }));

  // The policy decides; this action only gathers the facts it needs.
  const decision = activateSubscription({
    actorRole: user.role,
    studentStatus: student.status as StudentStatus,
    existingPeriods,
    plan: {
      id: plan.id,
      isActive: plan.is_active,
      pricePaise: toPaise(plan.price_paise),
      durationDays: plan.duration_days,
      mealSlots: plan.included_meal_slots as MealSlot[],
    },
    timeZone: user.timezone,
    now: new Date(),
    ...(parsed.data.startDate ? { startDate: toServiceDate(parsed.data.startDate) } : {}),
    ...(parsed.data.assignmentDurationDays
      ? { assignmentDurationDays: Number(parsed.data.assignmentDurationDays) }
      : {}),
    ...(parsed.data.overrideRupees ? { overrideRupees: Number(parsed.data.overrideRupees) } : {}),
  });

  if (!decision.ok) return { error: decision.error.message };
  const activation = decision.value;

  const { data: created, error: insertError } = await admin
    .from("subscriptions")
    .insert({
      tenant_id: user.tenantId,
      student_id: student.id,
      plan_id: activation.planId,
      // Frozen here, deliberately. A later plan price change must never rewrite
      // what this student agreed to (§4.2).
      price_paise_snapshot: activation.pricePaiseSnapshot,
      included_meal_slots_snapshot: [...activation.mealSlotsSnapshot],
      // What was bought and what the formula said it should cost, kept beside
      // what was actually charged so a discount is visible later (D-17).
      plan_duration_days_snapshot: activation.planDurationDaysSnapshot,
      assignment_duration_days: activation.assignmentDurationDays,
      calculated_price_paise: activation.calculatedPricePaise,
      is_price_overridden: activation.isPriceOverridden,
      start_date: activation.startDate,
      end_date: activation.endDate,
      status: "ACTIVE",
    })
    .select("id")
    .single();

  if (insertError) {
    // The partial unique index is the real guarantee — the count check above can
    // lose a race between two admins assigning at once.
    // 23P01 is the exclusion constraint: another plan already covers those
    // days. Normally the policy catches this first, but the constraint is the
    // real guarantee when two admins assign at the same instant.
    if (insertError.code === "23P01") {
      return { error: "Another plan already covers those dates. Reload the page." };
    }
    return { error: `Could not assign the plan: ${insertError.message}` };
  }

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "SUBSCRIPTION_ACTIVATED",
    entityType: "subscription",
    entityId: created.id,
    after: {
      studentId: student.id,
      planId: activation.planId,
      pricePaise: activation.pricePaiseSnapshot,
      calculatedPricePaise: activation.calculatedPricePaise,
      priceOverridden: activation.isPriceOverridden,
      assignmentDurationDays: activation.assignmentDurationDays,
      planDurationDays: activation.planDurationDaysSnapshot,
      startDate: activation.startDate,
      endDate: activation.endDate,
    },
  });

  revalidatePath(`/admin/students/${student.id}`);
  revalidatePath("/admin/students");

  return { success: "Plan assigned. The student can now be served at the counter." };
}

// --- End a subscription ---------------------------------------------------

const endSchema = z.object({
  subscriptionId: z.string().uuid(),
  reason: z.string().trim().min(3, "Give a reason").max(500),
});

export async function endSubscription(
  studentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const loaded = await loadOwnedStudent(studentId);
  if ("error" in loaded) return { error: loaded.error };
  const { user, admin, student } = loaded;

  const parsed = endSchema.safeParse({
    subscriptionId: formData.get("subscriptionId"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { error, count } = await admin
    .from("subscriptions")
    .update({ status: "CANCELLED" }, { count: "exact" })
    .eq("id", parsed.data.subscriptionId)
    .eq("tenant_id", user.tenantId)
    .eq("student_id", student.id)
    // Only an ACTIVE subscription may be cancelled — the state machine allows
    // no transition out of EXPIRED or CANCELLED.
    .eq("status", "ACTIVE");

  if (error) return { error: `Could not end the plan: ${error.message}` };
  if (count === 0) {
    return { error: "That plan is no longer active. Reload the page." };
  }

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "SUBSCRIPTION_CANCELLED",
    entityType: "subscription",
    entityId: parsed.data.subscriptionId,
    before: { status: "ACTIVE" },
    after: { status: "CANCELLED", reason: parsed.data.reason },
  });

  revalidatePath(`/admin/students/${student.id}`);
  revalidatePath("/admin/students");

  return { success: "Plan ended. You can now assign a new one." };
}

// --- Delete an upcoming subscription ---------------------------------------

/**
 * Deletes a plan that has not started — usually an early renewal on the wrong
 * plan or dates, which otherwise holds its dates and blocks the correction.
 *
 * The full row goes to the audit log before it is removed, so "I renewed him for
 * October and it vanished" still has an answer. A term that has started is
 * never deleted; see `canDeleteScheduledSubscription`.
 */
export async function deleteScheduledSubscription(
  studentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const loaded = await loadOwnedStudent(studentId);
  if ("error" in loaded) return { error: loaded.error };
  const { user, admin, student } = loaded;

  const parsed = endSchema.safeParse({
    subscriptionId: formData.get("subscriptionId"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const subscriptionId = parsed.data.subscriptionId;

  const [{ data: row }, cuts, pauses] = await Promise.all([
    admin
      .from("subscriptions")
      .select(
        "id, plan_id, status, start_date, end_date, price_paise_snapshot, included_meal_slots_snapshot",
      )
      .eq("id", subscriptionId)
      .eq("tenant_id", user.tenantId)
      .eq("student_id", student.id)
      .maybeSingle(),
    admin
      .from("mess_cuts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", user.tenantId)
      .eq("subscription_id", subscriptionId)
      .in("status", ["PENDING", "APPROVED", "CREDITED"]),
    admin
      .from("subscription_pauses")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", user.tenantId)
      .eq("subscription_id", subscriptionId)
      .eq("status", "ACTIVE"),
  ]);
  if (!row) return { error: "That plan no longer exists. Reload the page." };

  const today = serviceDateOf(user.timezone, new Date());
  const decision = canDeleteScheduledSubscription({
    actorRole: user.role,
    subscription: {
      status: row.status,
      startDate: toServiceDate(row.start_date),
      endDate: toServiceDate(row.end_date),
    },
    today,
    liveAbsences: cuts.count ?? 0,
    livePauses: pauses.count ?? 0,
  });
  if (!decision.ok) return { error: decision.error.message };

  const { error, count } = await admin
    .from("subscriptions")
    .delete({ count: "exact" })
    .eq("id", subscriptionId)
    .eq("tenant_id", user.tenantId)
    .eq("student_id", student.id)
    .eq("status", "ACTIVE")
    // The real guarantee, not the check above: a page left open past midnight
    // must not delete a term that has since started.
    .gt("start_date", today);

  if (error) return { error: `Could not delete the plan: ${error.message}` };
  if (count === 0) {
    return { error: "That plan has started or changed. Reload the page." };
  }

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "SUBSCRIPTION_DELETED",
    entityType: "subscription",
    entityId: subscriptionId,
    before: {
      planId: row.plan_id,
      status: row.status,
      startDate: row.start_date,
      endDate: row.end_date,
      pricePaise: row.price_paise_snapshot,
      mealSlots: row.included_meal_slots_snapshot.join(","),
    },
    after: { deleted: true, reason: parsed.data.reason },
  });

  revalidatePath(`/admin/students/${student.id}`);
  revalidatePath("/admin/students");

  return { success: "Upcoming plan deleted. Its dates are free again." };
}

// --- Photo -----------------------------------------------------------------

/** Matches the bucket's own limit, so the failure is caught before the upload. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Uploads the photo staff see at the counter.
 *
 * §6.3: the QR proves possession of a phone, not identity. Without a face on
 * the scanner, a student can hand their phone to a friend and nobody can tell.
 */
export async function uploadStudentPhoto(
  studentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const loaded = await loadOwnedStudent(studentId);
  if ("error" in loaded) return { error: loaded.error };
  const { user, admin, student } = loaded;

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo first." };
  if (file.size > MAX_PHOTO_BYTES) {
    return { error: "That image is larger than 2 MB. Use a smaller photo." };
  }
  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
    return { error: "Use a JPEG, PNG or WebP image." };
  }

  // The tenant id is the first path segment, which is what the storage policies
  // match on — so the layout itself carries the tenancy boundary.
  const path = `${user.tenantId}/${student.id}`;

  const { error: uploadError } = await admin.storage
    .from("student-photos")
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) return { error: `Could not upload: ${uploadError.message}` };

  const { error: linkError } = await admin
    .from("profiles")
    .update({ photo_url: path })
    .eq("id", student.profile_id)
    .eq("tenant_id", user.tenantId);

  if (linkError) {
    // The file is stored but nothing points at it. Say so rather than claiming
    // success, or staff will wonder why the counter shows no face.
    return { error: `Uploaded, but could not attach it to the student: ${linkError.message}` };
  }

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "STUDENT_PHOTO_UPDATED",
    entityType: "student",
    entityId: student.id,
    after: { rollNumber: student.roll_number },
  });

  revalidatePath(`/admin/students/${student.id}`);
  return { success: "Photo saved. Staff will see it at the counter." };
}

export async function removeStudentPhoto(studentId: string): Promise<ActionState> {
  const loaded = await loadOwnedStudent(studentId);
  if ("error" in loaded) return { error: loaded.error };
  const { user, admin, student } = loaded;

  await admin.storage.from("student-photos").remove([`${user.tenantId}/${student.id}`]);

  const { error } = await admin
    .from("profiles")
    .update({ photo_url: null })
    .eq("id", student.profile_id)
    .eq("tenant_id", user.tenantId);

  if (error) return { error: `Could not remove the photo: ${error.message}` };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "STUDENT_PHOTO_REMOVED",
    entityType: "student",
    entityId: student.id,
    before: { rollNumber: student.roll_number },
  });

  revalidatePath(`/admin/students/${student.id}`);
  return { success: "Photo removed." };
}

// --- Renew a subscription --------------------------------------------------

const renewSchema = z.object({
  planId: z.string().uuid("Choose a plan."),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid start date"),
  assignmentDurationDays: z.string().trim(),
  overrideRupees: z.string().trim(),
});

/**
 * Renews a student's plan for another term.
 *
 * Mechanically the same as assigning one — a brand-new subscription row with
 * its own frozen price, per the pricing spec §8.3 — and deliberately kept as a
 * separate action so the audit log records a renewal rather than an assignment,
 * and so the previous term can be named in it.
 *
 * It does NOT touch the previous subscription. Since migration 017 the rule is
 * simply that no two subscriptions may cover the same day, so the old term runs
 * to its natural end and the new one begins after it. Nothing is truncated and
 * no paid day is discarded — an overlapping date is refused outright, with the
 * first free date named.
 */
export async function renewSubscription(
  studentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const loaded = await loadOwnedStudent(studentId);
  if ("error" in loaded) return { error: loaded.error };
  const { user, admin, student } = loaded;

  const parsed = renewSchema.safeParse({
    planId: formData.get("planId"),
    startDate: formData.get("startDate") ?? "",
    assignmentDurationDays: formData.get("assignmentDurationDays") ?? "",
    overrideRupees: formData.get("overrideRupees") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { data: plan } = await admin
    .from("plans")
    .select("id, name, is_active, price_paise, duration_days, included_meal_slots")
    .eq("id", parsed.data.planId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!plan) return { error: "That plan does not exist in this mess." };

  const { data: existingRows } = await admin
    .from("subscriptions")
    .select("id, status, start_date, end_date")
    .eq("tenant_id", user.tenantId)
    .eq("student_id", student.id);

  const existingPeriods = (existingRows ?? []).map((row) => ({
    status: row.status,
    startDate: toServiceDate(row.start_date),
    endDate: toServiceDate(row.end_date),
  }));

  const decision = activateSubscription({
    actorRole: user.role,
    studentStatus: student.status as StudentStatus,
    existingPeriods,
    plan: {
      id: plan.id,
      isActive: plan.is_active,
      pricePaise: toPaise(plan.price_paise),
      durationDays: plan.duration_days,
      mealSlots: plan.included_meal_slots as MealSlot[],
    },
    timeZone: user.timezone,
    now: new Date(),
    startDate: toServiceDate(parsed.data.startDate),
    ...(parsed.data.assignmentDurationDays
      ? { assignmentDurationDays: Number(parsed.data.assignmentDurationDays) }
      : {}),
    ...(parsed.data.overrideRupees ? { overrideRupees: Number(parsed.data.overrideRupees) } : {}),
  });
  if (!decision.ok) return { error: decision.error.message };
  const activation = decision.value;

  const { data: created, error: insertError } = await admin
    .from("subscriptions")
    .insert({
      tenant_id: user.tenantId,
      student_id: student.id,
      plan_id: activation.planId,
      price_paise_snapshot: activation.pricePaiseSnapshot,
      included_meal_slots_snapshot: [...activation.mealSlotsSnapshot],
      plan_duration_days_snapshot: activation.planDurationDaysSnapshot,
      assignment_duration_days: activation.assignmentDurationDays,
      calculated_price_paise: activation.calculatedPricePaise,
      is_price_overridden: activation.isPriceOverridden,
      start_date: activation.startDate,
      end_date: activation.endDate,
      status: "ACTIVE",
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23P01") {
      return { error: "Another plan already covers those dates. Reload the page." };
    }
    return { error: `Could not renew the plan: ${insertError.message}` };
  }

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "SUBSCRIPTION_RENEWED",
    entityType: "subscription",
    entityId: created.id,
    after: {
      studentId: student.id,
      planId: activation.planId,
      planName: plan.name,
      pricePaise: activation.pricePaiseSnapshot,
      startDate: activation.startDate,
      endDate: activation.endDate,
      // Which term this follows, so the chain is readable in the log.
      renewedFrom: existingPeriods.length,
    },
  });

  revalidatePath(`/admin/students/${student.id}`);
  revalidatePath("/admin/students");

  return {
    success: `Renewed on ${plan.name} — ${activation.startDate} to ${activation.endDate}.`,
  };
}
