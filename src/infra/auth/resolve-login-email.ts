/**
 * What the user typed → the Supabase Auth address to sign in as.
 *
 * Shared by the web Server Action and the mobile `POST /api/auth/login`, because
 * this is the one part of login with real logic in it and two copies would
 * eventually disagree about who a mobile number belongs to. Signing someone into
 * the wrong student's account is the worst outcome this codebase has, so it
 * happens in exactly one place.
 *
 * **This is why the app cannot talk to Supabase Auth directly.** A student types
 * a mobile number, but their Auth address is derived from their roll number
 * (`cs21b001@campus-crave.mess.invalid`). Resolving one to the other needs a
 * service-role read of `profiles` before any session exists — RLS cannot help
 * before authentication — and the service-role key must never ship inside a
 * Flutter binary. So login goes through the server, always.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyLoginIdentifier, syntheticEmailFor } from "@/core/domain/identity";
import { firstRelated } from "@/infra/supabase/mappers";
import type { Database } from "@/infra/supabase/database.types";

export type LoginEmailResolution =
  | { readonly ok: true; readonly email: string }
  /**
   * Nothing matched, or the input was not a usable identifier. Callers must
   * render one indistinguishable message for this and for a wrong password —
   * telling the two apart turns the form into a roll-number enumerator for the
   * whole hostel, and roll numbers are semi-public.
   */
  | { readonly ok: false; readonly reason: "GENERIC" }
  /**
   * Two students share this number. Never guess: refusing is recoverable,
   * signing someone into the wrong account is not. The student cannot fix this
   * themselves, so the message must name the remedy.
   */
  | { readonly ok: false; readonly reason: "AMBIGUOUS_MOBILE" };

/**
 * @param admin service-role client — there is no session yet, so RLS cannot
 *   scope this read and the query below filters explicitly instead.
 */
export async function resolveLoginEmail(
  admin: SupabaseClient<Database>,
  rawIdentifier: string,
): Promise<LoginEmailResolution> {
  const identifier = classifyLoginIdentifier(rawIdentifier);
  if (!identifier) return { ok: false, reason: "GENERIC" };

  if (identifier.kind === "EMAIL") {
    return { ok: true, email: identifier.email };
  }

  // `mobile` is a generated column holding the last ten digits, so
  // `+91 98765-43210` and `9876543210` resolve to the same student.
  const { data: matches, error } = await admin
    .from("profiles")
    .select("mobile, students!inner ( roll_number ), tenants!inner ( slug )")
    .eq("role", "STUDENT")
    .eq("mobile", identifier.mobile)
    .limit(2);

  if (error || !matches || matches.length === 0) return { ok: false, reason: "GENERIC" };
  if (matches.length > 1) return { ok: false, reason: "AMBIGUOUS_MOBILE" };

  // Both embeds are to-one (`students.profile_id` is unique, `tenant_id` is a
  // FK), so PostgREST collapses each to an object rather than an array. Reading
  // `[0]` here would silently yield undefined — see firstRelated().
  const row = matches[0]!;
  const tenant = firstRelated<{ slug: string }>(row.tenants as never);
  const student = firstRelated<{ roll_number: string }>(row.students as never);
  if (!tenant || !student) return { ok: false, reason: "GENERIC" };

  return { ok: true, email: syntheticEmailFor(tenant.slug, student.roll_number) };
}
