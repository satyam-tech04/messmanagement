/**
 * "Delete my account", from inside the app (D-32).
 *
 * Both stores require a student to be able to start this without emailing
 * anyone, and until this endpoint existed the only route was a mailto on
 * /delete-account that somebody actioned by hand.
 *
 * The POST is destructive in a way no other endpoint here is: it ends the
 * caller's own session. That is deliberate and is what the app warns about
 * before it calls — access stops now, erasure follows within 30 days.
 *
 * GET exists so the app can show a student what they already asked for, and so
 * the confirm screen can say "you asked on the 3rd" instead of offering to do
 * it again.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { isErr } from "@/core/result";
import { requestAccountDeletion } from "@/core/services/account-deletion";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { createAdminClient } from "@/infra/supabase/admin";
import { createRepositories } from "@/infra/supabase/repositories";
import { SUPPORT_EMAIL } from "@/lib/app-info";

/**
 * Typed the way every irreversible confirmation in this app is: the word, not a
 * checkbox. A student who cannot be bothered to type it was not sure.
 */
const schema = z.object({
  confirm: z.literal("DELETE", {
    message: "Type DELETE to confirm.",
  }),
});

function fail(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);
  const { user, supabase } = auth.caller;

  const repos = createRepositories(supabase, createAdminClient());
  const open = await repos.accountDeletions.openRequestFor(user.tenantId, user.actorProfileId);

  return NextResponse.json(
    {
      // Only a student may ask, so the app hides the button for everyone else
      // rather than offering something the server will refuse.
      canRequest: user.role === "STUDENT",
      pending: open ? { requestedAt: open.requestedAt, eraseBy: open.eraseBy } : null,
      supportEmail: SUPPORT_EMAIL,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);
  const { user, supabase } = auth.caller;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_FAILED", "Malformed request.", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Type DELETE.", 400);
  }

  const repos = createRepositories(supabase, createAdminClient());
  const result = await requestAccountDeletion(user, {
    repo: repos.accountDeletions,
    now: () => new Date(),
  });

  if (isErr(result)) {
    const status =
      result.error.code === "FORBIDDEN"
        ? 403
        : result.error.code === "NOT_FOUND"
          ? 404
          : result.error.code === "INFRASTRUCTURE_ERROR"
            ? 503
            : 400;
    return fail(result.error.code, result.error.message, status);
  }

  await repos.audit.write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "ACCOUNT_DELETION_REQUESTED",
    entityType: "profile",
    entityId: user.actorProfileId,
    after: { eraseBy: result.value.eraseBy },
  });

  return NextResponse.json(
    {
      eraseBy: result.value.eraseBy,
      alreadyRequested: result.value.alreadyRequested,
      supportEmail: SUPPORT_EMAIL,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
