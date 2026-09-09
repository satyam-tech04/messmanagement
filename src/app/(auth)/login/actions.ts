"use server";

/**
 * Login. Accepts a roll number (students) or an email (staff and admins).
 *
 * The Server Action's job is exactly what CLAUDE.md rule 2 describes: validate
 * input with Zod, call out to resolve identity, map the result. No business
 * rules live here — the identity derivation is a pure function in
 * `core/domain/identity`.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/infra/supabase/server";
import { createAdminClient } from "@/infra/supabase/admin";
import { rateLimitBuckets, SupabaseRateLimiter } from "@/infra/supabase/repositories";
import { homeRouteFor } from "@/infra/auth/session";
import { resolveLoginEmail } from "@/infra/auth/resolve-login-email";
import type { UserRole } from "@/core/domain/enums";

const loginSchema = z.object({
  identifier: z.string().min(1, "Enter your roll number or email").max(320),
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional(),
});

export interface LoginState {
  readonly error?: string;
}

/**
 * Deliberately identical for every failure mode.
 *
 * Distinguishing "no such roll number" from "wrong password" would turn the
 * login form into a roll-number enumerator for the whole hostel — and roll
 * numbers are semi-public, so confirming which ones exist has real value to
 * someone probing.
 */
const GENERIC_FAILURE = "Incorrect roll number, email, or password.";

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details and try again." };
  }

  const admin = createAdminClient();
  const limiter = new SupabaseRateLimiter(admin);

  // Throttle per identifier. Supabase Auth rate-limits by IP; this adds a
  // per-account limit so a single account cannot be brute-forced from many
  // addresses. 10 attempts in 5 minutes is far above honest mistyping.
  const allowed = await limiter.consume(rateLimitBuckets.login(parsed.data.identifier), 300, 10);
  if (!allowed) {
    return { error: "Too many attempts. Wait a few minutes and try again." };
  }

  // Shared with `POST /api/auth/login` so the two transports can never disagree
  // about which account a mobile number belongs to.
  const resolved = await resolveLoginEmail(admin, parsed.data.identifier);
  if (!resolved.ok) {
    return {
      error:
        resolved.reason === "AMBIGUOUS_MOBILE"
          ? "That mobile number is registered to more than one student. Ask your mess admin to correct it."
          : GENERIC_FAILURE,
    };
  }
  const email = resolved.email;

  const supabase = await createClient();
  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });

  if (signInError || !signIn.user) return { error: GENERIC_FAILURE };

  // Read the role from the freshly issued token so the redirect lands on the
  // right shell without another round trip.
  const { data: claimsData } = await supabase.auth.getClaims();
  const role = (claimsData?.claims as { user_role?: UserRole } | undefined)?.user_role;

  // Only ever redirect to a path within this app. An absolute URL from the
  // query string is an open redirect straight into a phishing page.
  const next = parsed.data.next;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;

  redirect(safeNext ?? homeRouteFor(role ?? "STUDENT"));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
