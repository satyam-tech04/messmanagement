/**
 * Password sign-in for the mobile app (§ mobile Slice 1).
 *
 * **Why this exists rather than the app calling Supabase Auth directly.** A
 * student types a mobile number, but their Auth address is derived from their
 * roll number (`cs21b001@campus-crave.mess.invalid`). Turning one into the other
 * is a service-role read of `profiles` — there is no session yet, so RLS cannot
 * scope it — and the service-role key must never ship inside a binary anyone can
 * unpack. Going through the server also keeps the per-identifier rate limit,
 * which a direct Supabase call would bypass entirely.
 *
 * The tokens come back in the body, not as cookies: a native client has no
 * cookie jar and refreshes them itself through the Supabase token grant.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserFromToken } from "@/infra/auth/session";
import { resolveLoginEmail } from "@/infra/auth/resolve-login-email";
import { toSessionPayload } from "@/infra/http/session-payload";
import { createAdminClient } from "@/infra/supabase/admin";
import { createAnonClient } from "@/infra/supabase/anon";
import { rateLimitBuckets, SupabaseRateLimiter } from "@/infra/supabase/repositories";

const schema = z.object({
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(72),
});

/**
 * One message for every failure mode, exactly as the web form does.
 *
 * Distinguishing "no such student" from "wrong password" would turn this
 * endpoint into a roll-number enumerator for the whole hostel — and an API is a
 * far better enumerator than a form, because it is trivial to script.
 */
const GENERIC_FAILURE = "Incorrect mobile number, email, or password.";

function failure(message: string, status: number, code: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("Malformed request.", 400, "VALIDATION_FAILED");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return failure(GENERIC_FAILURE, 401, "INVALID_CREDENTIALS");

  const admin = createAdminClient();
  const limiter = new SupabaseRateLimiter(admin);

  // Per identifier, not per IP. Supabase limits by IP already; this stops one
  // account being ground down from many addresses. 10 attempts in 5 minutes is
  // far above honest mistyping.
  const allowed = await limiter.consume(rateLimitBuckets.login(parsed.data.identifier), 300, 10);
  if (!allowed) {
    return failure("Too many attempts. Wait a few minutes and try again.", 429, "RATE_LIMITED");
  }

  const resolved = await resolveLoginEmail(admin, parsed.data.identifier);
  if (!resolved.ok) {
    if (resolved.reason === "AMBIGUOUS_MOBILE") {
      return failure(
        "That mobile number is registered to more than one student. Ask your mess admin to correct it.",
        409,
        "AMBIGUOUS_MOBILE",
      );
    }
    return failure(GENERIC_FAILURE, 401, "INVALID_CREDENTIALS");
  }

  const supabase = createAnonClient();
  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
    email: resolved.email,
    password: parsed.data.password,
  });

  if (signInError || !signIn.session) return failure(GENERIC_FAILURE, 401, "INVALID_CREDENTIALS");

  // Resolve the full session the same way every other endpoint does, so a
  // suspended tenant or a disabled account cannot sign in even holding a
  // correct password — `getSessionUserFromToken` fails closed on both.
  const user = await getSessionUserFromToken(signIn.session.access_token);
  if (!user) return failure(GENERIC_FAILURE, 401, "INVALID_CREDENTIALS");

  return NextResponse.json(
    {
      accessToken: signIn.session.access_token,
      refreshToken: signIn.session.refresh_token,
      expiresAt: signIn.session.expires_at ?? null,
      user: toSessionPayload(user),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
