"use server";

/**
 * Create a student and issue their credentials (decision D-02).
 *
 * Four things must happen together: an auth user, a profile, a student row, and
 * (optionally) an active subscription. Postgres cannot span the auth schema in
 * one transaction from here, so the ordering below is chosen so that a failure
 * at any step leaves nothing half-created that a retry would trip over — and
 * anything that does get orphaned is cleaned up explicitly.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isValidRollNumber, normalizeRollNumber, syntheticEmailFor } from "@/core/domain/identity";
import { subscriptionPeriodFor } from "@/core/policies/student-admin.policy";
import { serviceDateOf } from "@/core/time";
import { createAdminClient } from "@/infra/supabase/admin";
import { createClient } from "@/infra/supabase/server";
import { getSessionUser } from "@/infra/auth/session";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";
import { generateTemporaryPassword } from "@/lib/password";

const schema = z.object({
  rollNumber: z
    .string()
    .trim()
    .min(1, "Roll number is required")
    .refine(isValidRollNumber, "Use letters, digits, dot, underscore or hyphen only"),
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
  planId: z.string().uuid().optional().or(z.literal("")),
});

export interface CreateStudentState {
  readonly error?: string;
  readonly fieldErrors?: Record<string, string>;
  readonly created?: {
    readonly rollNumber: string;
    readonly fullName: string;
    readonly temporaryPassword: string;
    /** Set when the student was created but the plan assignment failed. */
    readonly planWarning?: string;
  };
}

export async function createStudent(
  _prev: CreateStudentState,
  formData: FormData,
): Promise<CreateStudentState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { error: "Only an admin can add students." };
  }

  const parsed = schema.safeParse({
    rollNumber: formData.get("rollNumber"),
    fullName: formData.get("fullName"),
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    block: formData.get("block") ?? "",
    roomNumber: formData.get("roomNumber") ?? "",
    planId: formData.get("planId") ?? "",
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
  const roll = normalizeRollNumber(input.rollNumber);
  const admin = createAdminClient();
  const supabase = await createClient();

  // Reject a duplicate before creating an auth user, so a retry after a typo
  // does not leave an orphaned account behind.
  const { data: existing } = await supabase
    .from("students")
    .select("id")
    .eq("tenant_id", user.tenantId)
    .ilike("roll_number", roll)
    .maybeSingle();

  if (existing) {
    return {
      error: `Roll number ${input.rollNumber} already exists in this mess.`,
      fieldErrors: { rollNumber: "Already in use" },
    };
  }

  const loginEmail = syntheticEmailFor(user.tenantSlug, roll);
  const temporaryPassword = generateTemporaryPassword();

  // --- 1. Auth user ---
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: loginEmail,
    password: temporaryPassword,
    // No mailbox exists behind a .invalid address, so confirmation must be
    // implicit — otherwise the student could never sign in.
    email_confirm: true,
    user_metadata: { full_name: input.fullName, roll_number: roll },
  });

  if (authError || !created.user) {
    return { error: `Could not create the login: ${authError?.message ?? "unknown error"}` };
  }
  const userId = created.user.id;

  /** Removes the orphaned auth user when a later step fails. */
  const rollback = async (message: string): Promise<CreateStudentState> => {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return { error: message };
  };

  // --- 2. Profile ---
  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    tenant_id: user.tenantId,
    role: "STUDENT",
    full_name: input.fullName,
    phone: input.phone || null,
    email: input.email || null,
    status: "ACTIVE",
    // The admin knows this password, so it must be changed before the account
    // is genuinely the student's.
    must_change_password: true,
  });
  if (profileError) return rollback(`Could not create the profile: ${profileError.message}`);

  // --- 3. Student ---
  const { data: student, error: studentError } = await admin
    .from("students")
    .insert({
      tenant_id: user.tenantId,
      profile_id: userId,
      roll_number: input.rollNumber.trim(),
      block: input.block || null,
      room_number: input.roomNumber || null,
      status: "ACTIVE",
      // Set explicitly rather than relying on the column's `default current_date`,
      // which is the database's UTC day: a student added at 02:00 IST would
      // otherwise be recorded as having joined the previous day (rule 9).
      joined_at: serviceDateOf(user.timezone, new Date()),
    })
    .select("id")
    .single();

  if (studentError || !student) {
    return rollback(`Could not create the student: ${studentError?.message}`);
  }

  // --- 4. Optional subscription, with the price snapshotted (§4.2) ---
  if (input.planId) {
    const { data: plan } = await admin
      .from("plans")
      .select("price_paise, included_meal_slots, duration_days")
      .eq("tenant_id", user.tenantId)
      .eq("id", input.planId)
      .maybeSingle();

    if (plan) {
      // Derived in the tenant's timezone, never from toISOString() — for an IST
      // hostel that shifts the date back a day for most of the working day and
      // ends the plan early (rule 9).
      const period = subscriptionPeriodFor({
        timeZone: user.timezone,
        now: new Date(),
        durationDays: plan.duration_days,
      });

      const { error: subscriptionError } = await admin.from("subscriptions").insert({
        tenant_id: user.tenantId,
        student_id: student.id,
        plan_id: input.planId,
        // Frozen now. A later plan price change must never rewrite history.
        price_paise_snapshot: plan.price_paise,
        included_meal_slots_snapshot: plan.included_meal_slots,
        start_date: period.startDate,
        end_date: period.endDate,
        status: "ACTIVE",
      });

      // The student exists either way; surfacing this beats silently creating an
      // account with no plan and leaving the admin to discover it at the counter.
      if (subscriptionError) {
        return {
          created: {
            rollNumber: input.rollNumber.trim(),
            fullName: input.fullName,
            temporaryPassword,
            planWarning: `The login was created, but the plan could not be assigned: ${subscriptionError.message}. Assign it from the student's page.`,
          },
        };
      }
    }
  }

  // Creating a login is exactly the kind of action that becomes a dispute.
  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "STUDENT_CREATED",
    entityType: "student",
    entityId: student.id,
    after: { rollNumber: roll, fullName: input.fullName, planAssigned: Boolean(input.planId) },
  });

  revalidatePath("/admin/students");

  // Returned once, shown once. The password is not stored anywhere readable —
  // if the admin loses it before handing it over, they reset it rather than
  // recovering it.
  return {
    created: {
      rollNumber: input.rollNumber.trim(),
      fullName: input.fullName,
      temporaryPassword,
    },
  };
}
