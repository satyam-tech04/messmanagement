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
import { classifyLoginIdentifier, syntheticEmailFor } from "@/core/domain/identity";
import { createClient } from "@/infra/supabase/server";
import { createAdminClient } from "@/infra/supabase/admin";
import { rateLimitBuckets, SupabaseRateLimiter } from "@/infra/supabase/repositories";
import { homeRouteFor } from "@/infra/auth/session";
import { firstRelated } from "@/infra/supabase/mappers";
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

  const identifier = classifyLoginIdentifier(parsed.data.identifier);
  if (!identifier) return { error: GENERIC_FAILURE };

  const admin = createAdminClient();
  const limiter = new SupabaseRateLimiter(admin);

  // Throttle per identifier. Supabase Auth rate-limits by IP; this adds a
  // per-account limit so a single account cannot be brute-forced from many
  // addresses. 10 attempts in 5 minutes is far above honest mistyping.
  const allowed = await limiter.consume(rateLimitBuckets.login(parsed.data.identifier), 300, 10);
  if (!allowed) {
    return { error: "Too many attempts. Wait a few minutes and try again." };
  }

  let email: string;

  if (identifier.kind === "EMAIL") {
    email = identifier.email;
  } else {
    // The student typed a mobile number, but their Supabase Auth address is
    // still derived from their roll number — changing that would mean rewriting
    // every auth user in the hostel. So the number is resolved to the student
    // first, and the sign-in happens as the address they have always had.
    //
    // Runs with the service role because there is no session yet; RLS cannot
    // help before authentication. `mobile` is a generated column holding the
    // last ten digits, so `+91 98765-43210` and `9876543210` are one student.
    const { data: matches, error } = await admin
      .from("profiles")
      .select("mobile, students!inner ( roll_number ), tenants!inner ( slug )")
      .eq("role", "STUDENT")
      .eq("mobile", identifier.mobile)
      .limit(2);

    if (error || !matches || matches.length === 0) return { error: GENERIC_FAILURE };

    if (matches.length > 1) {
      // Two students share this number. Never guess — signing someone into the
      // wrong account is worse than refusing, and this is a real state until
      // migration 012's unique index lands. Said plainly, because the student
      // cannot fix it and the admin can.
      return {
        error:
          "That mobile number is registered to more than one student. Ask your mess admin to correct it.",
      };
    }

    // Both embeds are to-one (students.profile_id is unique, tenant_id is a FK),
    // so PostgREST collapses each to an object rather than an array. Reading
    // `[0]` here would silently yield undefined — see firstRelated().
    const row = matches[0]!;
    const tenant = firstRelated<{ slug: string }>(row.tenants as never);
    const student = firstRelated<{ roll_number: string }>(row.students as never);
    if (!tenant || !student) return { error: GENERIC_FAILURE };

    email = syntheticEmailFor(tenant.slug, student.roll_number);
  }

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
