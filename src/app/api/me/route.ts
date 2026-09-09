/**
 * The caller's session and their mess's settings, in one request.
 *
 * The app needs both before it can render anything: the role decides which shell
 * to route to, and the feature flags decide which tabs exist at all. Absences and
 * Feedback ship **off** by default, and a screen for a disabled feature must not
 * merely 404 — it must never appear.
 *
 * Collapsing them into one call matters on a phone at the mess door: this is the
 * request standing between a cold start and a usable app.
 *
 * The QR signing secret lives in `tenant_secrets`, which the settings repository
 * never reads, so there is nothing sensitive to strip here — but note that
 * `toSessionPayload` deliberately omits the internal ids. See its doc comment.
 */
import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { toSessionPayload } from "@/infra/http/session-payload";
import { createAdminClient } from "@/infra/supabase/admin";
import { createRepositories } from "@/infra/supabase/repositories";

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: auth.message } },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { user, supabase } = auth.caller;

  const repos = createRepositories(supabase, createAdminClient());
  const settings = await repos.tenants.getSettings(user.tenantId);

  // Fail closed (§2.7). Settings decide which meals exist and which features are
  // on; guessing a default here would show a student a tab their mess disabled.
  if (!settings) {
    return NextResponse.json(
      {
        error: {
          code: "INFRASTRUCTURE_ERROR",
          message: "Could not read your mess's settings. Try again.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { user: toSessionPayload(user), settings },
    { headers: { "Cache-Control": "no-store" } },
  );
}
