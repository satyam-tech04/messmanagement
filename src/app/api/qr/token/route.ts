/**
 * QR token issuance endpoint (§6.1).
 *
 * The student's screen polls this every `refreshSeconds`. Everything it needs
 * to render — which meal, whether the counter is open, when it closes — comes
 * back in one response, so the screen never makes a second round trip mid-queue.
 *
 * `no-store` matters more than usual here: a cached QR token is a token that
 * outlives its TTL, which is the one property the whole scheme depends on.
 */
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { issueQrToken } from "@/core/services/issue-qr-token";
import { isErr } from "@/core/result";
import { hmacTokenSigner } from "@/infra/crypto/hmac-signer";
import { getSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { createClient } from "@/infra/supabase/server";
import { createRepositories, rateLimitBuckets } from "@/infra/supabase/repositories";

/** Denial codes the student's own screen should explain, not retry. */
const DENIAL_STATUS: Record<string, number> = {
  FORBIDDEN: 403,
  BLOCKED_UNPAID: 403,
  STUDENT_INACTIVE: 403,
  NO_ACTIVE_PLAN: 403,
  ON_MESS_CUT: 403,
  SLOT_NOT_SERVED: 409,
  // Not a fault — the student has eaten. The screen renders it as a receipt.
  ALREADY_SERVED: 409,
  NOT_FOUND: 404,
  INFRASTRUCTURE_ERROR: 503,
};

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in again." } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const repos = createRepositories(supabase, admin);

  // A phone refreshing every 15s makes ~4 calls a minute; this allows a
  // generous multiple of that and still stops a script minting thousands of
  // codes to hand around.
  const allowed = await repos.rateLimiter.consume(
    rateLimitBuckets.qrToken(user.tenantId, user.actorProfileId),
    60,
    40,
  );
  if (!allowed) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Wait a moment and try again.",
        },
      },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = await issueQrToken(
    {
      tenantId: user.tenantId,
      tenantSlug: user.tenantSlug,
      timezone: user.timezone,
      actorProfileId: user.actorProfileId,
      role: user.role,
      ...(user.studentId ? { studentId: user.studentId } : {}),
    },
    {
      tenants: repos.tenants,
      students: repos.students,
      messCuts: repos.messCuts,
      attendance: repos.attendance,
      signer: hmacTokenSigner,
      now: () => new Date(),
      nonce: () => randomBytes(9).toString("base64url"),
    },
  );

  if (isErr(result)) {
    const { code, message } = result.error;
    return NextResponse.json(
      { error: { code, message, details: result.error.details ?? null } },
      { status: DENIAL_STATUS[code] ?? 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const issued = result.value;

  return NextResponse.json(
    {
      token: issued.token,
      mealSlot: issued.mealSlot,
      serviceDate: issued.serviceDate,
      expiresAt: issued.expiresAt.toISOString(),
      refreshSeconds: issued.refreshSeconds,
      isOpenNow: issued.isOpenNow,
      opensAt: issued.opensAt.toISOString(),
      closesAt: issued.closesAt.toISOString(),
      studentName: issued.studentName,
      rollNumber: issued.rollNumber,
    },
    // A cached token is a token that outlives its TTL.
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}
