"use server";

/**
 * First-login password change (decision D-02).
 *
 * Admins issue students a temporary password, so until the student sets their
 * own, the admin knows a working credential for that account. Every route stays
 * gated until `must_change_password` is cleared.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/infra/supabase/server";
import { getSessionUser, homeRouteFor } from "@/infra/auth/session";

const schema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "The two passwords do not match",
    path: ["confirm"],
  });

export interface ChangePasswordState {
  readonly error?: string;
}

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const parsed = schema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your password and try again." };
  }

  const supabase = await createClient();

  const { error: updateError } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (updateError) {
    // Supabase rejects a new password identical to the current one, which is
    // exactly what a student who ignored the prompt would try.
    return { error: updateError.message };
  }

  // Clear the flag only after the password actually changed. Clearing it first
  // would let a failed update leave the account permanently ungated while still
  // using the admin-known temporary password.
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.actorProfileId);

  if (profileError) {
    return { error: "Password changed, but the account could not be updated. Try again." };
  }

  redirect(homeRouteFor(user.role));
}
