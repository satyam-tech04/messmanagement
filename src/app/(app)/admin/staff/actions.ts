"use server";

/**
 * Counter-staff logins.
 *
 * A mess that hires somebody needs them scanning the same evening. Before this,
 * staff accounts existed only where a provisioning script had put them, so the
 * customer had to come back to us for something they should never have to ask
 * for.
 *
 * Staff sign in with a **real email address**, unlike students, whose login is
 * derived from a roll number into an unreachable `.invalid` address. The rules
 * live in `staff-admin.policy.ts`; these actions authenticate, validate, call
 * the policy and map the result.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseStaffInvite } from "@/core/policies/staff-admin.policy";
import { createAdminClient } from "@/infra/supabase/admin";
import { getSessionUser } from "@/infra/auth/session";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";
import { generateTemporaryPassword } from "@/lib/password";

export interface StaffActionState {
  readonly error?: string;
  readonly success?: string;
  /** Shown exactly once, on the screen that created or reset the account. */
  readonly temporaryPassword?: string;
  readonly email?: string;
}

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." as const };
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { error: "Only an admin can manage staff logins." as const };
  }
  return { user, admin: createAdminClient() };
}

const inviteSchema = z.object({
  fullName: z.string(),
  email: z.string(),
  phone: z.string().optional(),
});

export async function createStaffLogin(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const parsed = inviteSchema.safeParse({
    fullName: formData.get("fullName") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
  });
  if (!parsed.success) return { error: "Check the form." };

  const decision = parseStaffInvite({ actorRole: user.role, ...parsed.data });
  if (!decision.ok) return { error: decision.error.message };
  const invite = decision.value;

  const temporaryPassword = generateTemporaryPassword();

  // --- 1. Auth user ---
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: invite.email,
    password: temporaryPassword,
    // No invitation mail is sent — the admin hands the password over in person,
    // which is the same channel every other account in this system uses. An
    // unconfirmed address could never sign in.
    email_confirm: true,
    user_metadata: { full_name: invite.fullName },
  });

  if (authError || !created.user) {
    const message = authError?.message ?? "unknown error";
    // Auth enforces one account per address across the whole platform, so this
    // is the likeliest failure and deserves a sentence rather than a raw error.
    if (/already/i.test(message)) {
      return { error: `${invite.email} already has a login. Use a different address.` };
    }
    return { error: `Could not create the login: ${message}` };
  }

  // --- 2. Profile ---
  //
  // The profile is what makes the account a member of THIS mess: the auth user
  // alone carries no tenant. An orphaned auth user cannot sign in anywhere
  // useful but would block the address forever, so it is removed on failure.
  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    tenant_id: user.tenantId,
    role: "STAFF",
    full_name: invite.fullName,
    email: invite.email,
    phone: invite.phone,
    status: "ACTIVE",
    // The admin knows this password, so the account is not genuinely theirs
    // until they choose their own at first sign-in.
    must_change_password: true,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return { error: `Could not create the staff record: ${profileError.message}` };
  }

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "STAFF_CREATED",
    entityType: "profile",
    entityId: created.user.id,
    // Never the password, not even hashed: an audit log is read by more people
    // than a credential ever should be.
    after: { fullName: invite.fullName, email: invite.email, role: "STAFF" },
  });

  revalidatePath("/admin/staff");

  return {
    success: `${invite.fullName} can sign in now.`,
    temporaryPassword,
    email: invite.email,
  };
}

const profileIdSchema = z.string().uuid("Staff member not found.");

export async function resetStaffPassword(
  profileId: string,
  _prev: StaffActionState,
  _formData: FormData,
): Promise<StaffActionState> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  if (!profileIdSchema.safeParse(profileId).success) {
    return { error: "Staff member not found." };
  }

  // The service-role client bypasses RLS, so this tenant check IS the boundary:
  // without it a guessed id from another mess would be resettable (rule 8).
  const { data: staff } = await admin
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("id", profileId)
    .eq("tenant_id", user.tenantId)
    .eq("role", "STAFF")
    .maybeSingle();

  if (!staff) return { error: "Staff member not found." };

  const temporaryPassword = generateTemporaryPassword();

  const { error: authError } = await admin.auth.admin.updateUserById(staff.id, {
    password: temporaryPassword,
  });
  if (authError) return { error: `Could not reset the password: ${authError.message}` };

  const { error: flagError } = await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", staff.id)
    .eq("tenant_id", user.tenantId);

  if (flagError) {
    // The password has already changed, so this cannot be quietly rolled back.
    return {
      error:
        "The password was reset, but the forced-change flag could not be set. Tell them to change it themselves.",
      temporaryPassword,
    };
  }

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "STAFF_PASSWORD_RESET",
    entityType: "profile",
    entityId: staff.id,
    after: { fullName: staff.full_name },
  });

  revalidatePath("/admin/staff");

  return {
    success: `New password for ${staff.full_name}.`,
    temporaryPassword,
    ...(staff.email ? { email: staff.email } : {}),
  };
}
