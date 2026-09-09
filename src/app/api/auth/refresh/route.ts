/**
 * Exchange a refresh token for a fresh access token.
 *
 * The app could call Supabase's token grant directly — it is a public endpoint
 * and the anon key is not a secret. It goes through here anyway so the binary
 * needs exactly **one** base URL and no Supabase configuration at all. Two hosts
 * in a mobile client means two things to get wrong per environment, and the
 * symptom of getting the second one wrong is an app that logs everybody out an
 * hour after release.
 *
 * Deliberately unauthenticated in the `authenticateApiRequest` sense: the access
 * token being refreshed has usually just expired, so requiring a valid one would
 * defeat the purpose. The refresh token itself is the credential, and Supabase
 * verifies it.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserFromToken } from "@/infra/auth/session";
import { toSessionPayload } from "@/infra/http/session-payload";
import { createAnonClient } from "@/infra/supabase/anon";

const schema = z.object({
  refreshToken: z.string().min(1).max(4096),
});

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
  if (!parsed.success) return failure("Sign in again.", 401, "UNAUTHENTICATED");

  const supabase = createAnonClient();
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: parsed.data.refreshToken,
  });

  // A revoked or rotated refresh token lands here. `UNAUTHENTICATED` tells the
  // client to clear its store and show the login screen rather than retry — a
  // client that retries a dead refresh token loops forever.
  if (error || !data.session) return failure("Sign in again.", 401, "UNAUTHENTICATED");

  // Re-resolve rather than trusting the old session: a tenant suspended or an
  // account disabled since the last token was issued must not be refreshed back
  // into a working session. `getSessionUserFromToken` fails closed on both.
  const user = await getSessionUserFromToken(data.session.access_token);
  if (!user) return failure("Sign in again.", 401, "UNAUTHENTICATED");

  return NextResponse.json(
    {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? null,
      user: toSessionPayload(user),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
