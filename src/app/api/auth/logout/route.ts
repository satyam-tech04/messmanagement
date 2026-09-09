/**
 * Sign out from the mobile app.
 *
 * Discarding the tokens on the device is not enough on its own: the refresh
 * token stays valid until it is revoked, and sessions here deliberately last a
 * year so a rebooted counter tablet does not strand staff at a login screen
 * (`session-lifetime.ts`). That trade is only acceptable if signing out actually
 * ends the session — otherwise a token lifted from a lost phone outlives the
 * logout that was supposed to stop it.
 *
 * Scope is `local`: revoke the refresh token this device is holding and leave
 * that person's other sessions alone. A student signing out of their phone must
 * not sign the counter tablet out from under staff mid-service.
 */
import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { createAdminClient } from "@/infra/supabase/admin";
import { parseBearerToken } from "@/lib/bearer-token";

export async function POST(request: Request) {
  // Still gated, so an unauthenticated caller cannot probe this endpoint — but
  // a user owing a password change must be able to sign out rather than being
  // trapped on the change screen with no way back.
  const auth = await authenticateApiRequest(request, { allowPasswordChangePending: true });
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: auth.message } },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const token = parseBearerToken(request.headers.get("authorization"));
  if (token) {
    // Revoked through the admin API because the request-scoped client holds no
    // stored session of its own to sign out of.
    await createAdminClient().auth.admin.signOut(token, "local");
  }

  // Deliberately 200 even if revocation failed: the client is about to discard
  // its tokens either way, and reporting failure would leave it holding
  // credentials it believes are still live. The token expires within the hour
  // regardless.
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
