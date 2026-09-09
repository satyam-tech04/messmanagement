/**
 * First-login password change for the mobile app (decision D-02).
 *
 * Admins issue students a temporary password derived from their own mobile
 * number, so until the student sets their own, someone else knows a working
 * credential for that account. `must_change_password` gates every other endpoint
 * until this one clears it.
 *
 * This is therefore the **only** route that may run while the flag is set —
 * hence `allowPasswordChangePending`. Gating it like everything else would lock
 * the user out of the single action that unlocks them.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { toSessionPayload } from "@/infra/http/session-payload";
import type { Database } from "@/infra/supabase/database.types";
import { parseBearerToken } from "@/lib/bearer-token";
import { publicEnv } from "@/lib/env";

const schema = z.object({
  password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
});

function failure(message: string, status: number, code: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Change the password **as the user**, on whichever transport they arrived on.
 *
 * A bearer caller cannot go through `supabase.auth.updateUser()`. That method
 * acts on the auth client's *stored* session, and `createBearerClient` keeps
 * none — it only attaches an `Authorization` header for PostgREST, deliberately,
 * because a persisted session on a warm serverless instance would leak between
 * requests. Calling it anyway fails with "Auth session missing!".
 *
 * So the token is sent straight to the auth endpoint instead. This is what
 * `updateUser` does underneath, and doing it as the user rather than through the
 * service role keeps Supabase's own checks — notably its refusal of a new
 * password identical to the current one, which is exactly what a student hoping
 * to keep the admin-issued temporary password would attempt.
 *
 * @returns an error message, or null on success.
 */
async function updatePassword(
  request: Request,
  supabase: SupabaseClient<Database>,
  password: string,
): Promise<string | null> {
  const token = parseBearerToken(request.headers.get("authorization"));

  if (!token) {
    // Cookie transport: the client holds a real session, so the SDK works.
    const { error } = await supabase.auth.updateUser({ password });
    return error ? error.message : null;
  }

  const res = await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });

  if (res.ok) return null;

  const body = (await res.json().catch(() => ({}))) as { msg?: string; message?: string };
  return body.msg ?? body.message ?? "Could not change the password.";
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request, { allowPasswordChangePending: true });
  if (!auth.ok) return failure(auth.message, auth.status, auth.code);
  const { user, supabase } = auth.caller;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("Malformed request.", 400, "VALIDATION_FAILED");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return failure(
      parsed.error.issues[0]?.message ?? "Check your password and try again.",
      400,
      "VALIDATION_FAILED",
    );
  }

  const updateError = await updatePassword(request, supabase, parsed.data.password);
  if (updateError) {
    // Supabase refuses a new password identical to the current one — exactly
    // what a student who wants to keep the temporary one would try.
    return failure(updateError, 400, "VALIDATION_FAILED");
  }

  // Clear the flag only after the password actually changed. Clearing it first
  // would let a failed update leave the account permanently ungated while still
  // using the admin-known temporary password. The order is load-bearing.
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.actorProfileId);

  if (profileError) {
    return failure(
      "Password changed, but the account could not be updated. Try again.",
      500,
      "INFRASTRUCTURE_ERROR",
    );
  }

  return NextResponse.json(
    { user: toSessionPayload({ ...user, mustChangePassword: false }) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
