/**
 * Creating one student, shared by the single-student form and the bulk form.
 *
 * Deliberately NOT a Server Action module — it exports a plain function so the
 * batch action can call it in a loop. Marking this file "use server" would turn
 * every export into its own endpoint.
 *
 * Four things must happen together: an auth user, a profile, a student row and
 * optionally a subscription. Postgres cannot span the auth schema in one
 * transaction from here, so the ordering is chosen so a failure at any step
 * leaves nothing half-created that a retry would trip over — and anything
 * orphaned is cleaned up explicitly.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRollNumber, syntheticEmailFor } from "@/core/domain/identity";
import { subscriptionPeriodFor } from "@/core/policies/student-admin.policy";
import { serviceDateOf } from "@/core/time";
import type { Database } from "@/infra/supabase/database.types";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";
import { generateTemporaryPassword } from "@/lib/password";

export interface CreateOneInput {
  readonly rollNumber: string;
  readonly fullName: string;
  readonly phone?: string;
  readonly email?: string;
  readonly block?: string;
  readonly roomNumber?: string;
  readonly planId?: string;
}

export interface CreateOneActor {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly timezone: string;
  readonly actorProfileId: string;
}

export type CreateOneResult =
  | {
      readonly ok: true;
      readonly studentId: string;
      readonly rollNumber: string;
      readonly fullName: string;
      readonly temporaryPassword: string;
      /** Set when the student exists but the plan could not be attached. */
      readonly planWarning?: string;
    }
  | { readonly ok: false; readonly rollNumber: string; readonly error: string };

export async function createOneStudent(
  admin: SupabaseClient<Database>,
  actor: CreateOneActor,
  input: CreateOneInput,
): Promise<CreateOneResult> {
  const roll = normalizeRollNumber(input.rollNumber);
  const loginEmail = syntheticEmailFor(actor.tenantSlug, roll);
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
    return {
      ok: false,
      rollNumber: input.rollNumber,
      error: `Could not create the login: ${authError?.message ?? "unknown error"}`,
    };
  }
  const userId = created.user.id;

  /** Removes the orphaned auth user when a later step fails. */
  const rollback = async (message: string): Promise<CreateOneResult> => {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return { ok: false, rollNumber: input.rollNumber, error: message };
  };

  // --- 2. Profile ---
  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    tenant_id: actor.tenantId,
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
      tenant_id: actor.tenantId,
      profile_id: userId,
      roll_number: input.rollNumber.trim(),
      block: input.block || null,
      room_number: input.roomNumber || null,
      status: "ACTIVE",
      // Set explicitly rather than relying on the column's `default current_date`,
      // which is the database's UTC day: a student added at 02:00 IST would
      // otherwise be recorded as having joined the previous day (rule 9).
      joined_at: serviceDateOf(actor.timezone, new Date()),
    })
    .select("id")
    .single();

  if (studentError || !student) {
    return rollback(`Could not create the student: ${studentError?.message}`);
  }

  let planWarning: string | undefined;

  // --- 4. Optional subscription, with the price snapshotted (§4.2) ---
  if (input.planId) {
    const { data: plan } = await admin
      .from("plans")
      .select("price_paise, included_meal_slots, duration_days")
      .eq("tenant_id", actor.tenantId)
      .eq("id", input.planId)
      .maybeSingle();

    if (plan) {
      // Derived in the tenant's timezone, never from toISOString() — for an IST
      // hostel that shifts the date back a day for most of the working day and
      // ends the plan early (rule 9).
      const period = subscriptionPeriodFor({
        timeZone: actor.timezone,
        now: new Date(),
        durationDays: plan.duration_days,
      });

      const { error: subscriptionError } = await admin.from("subscriptions").insert({
        tenant_id: actor.tenantId,
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
        planWarning = `The login was created, but the plan could not be assigned: ${subscriptionError.message}. Assign it from the student's page.`;
      }
    }
  }

  // Creating a login is exactly the kind of action that becomes a dispute.
  await new SupabaseAuditLogRepository(admin).write({
    tenantId: actor.tenantId,
    actorProfileId: actor.actorProfileId,
    action: "STUDENT_CREATED",
    entityType: "student",
    entityId: student.id,
    after: { rollNumber: roll, fullName: input.fullName, planAssigned: Boolean(input.planId) },
  });

  return {
    ok: true,
    studentId: student.id,
    rollNumber: input.rollNumber.trim(),
    fullName: input.fullName,
    temporaryPassword,
    planWarning,
  };
}
