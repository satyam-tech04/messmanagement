/**
 * Scan verification endpoint (§6.3) — the counter's critical path.
 *
 * Budget is p95 < 500 ms: at 200 students in 20 minutes there are about six
 * seconds per student including walking, so this does the minimum round trips
 * it can and the use case fetches the student, plan and cuts together.
 *
 * Fails closed everywhere. An indeterminate answer denies the scan and staff
 * use the audited manual fallback — a wrongly-denied meal costs 20 seconds, a
 * bypassable QR costs the product.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyManualAttendance, verifyQrAttendance } from "@/core/services/verify-attendance";
import { isErr } from "@/core/result";
import { hmacTokenSigner } from "@/infra/crypto/hmac-signer";
import { getSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { createClient } from "@/infra/supabase/server";
import { createRepositories, rateLimitBuckets } from "@/infra/supabase/repositories";

/**
 * Denials return 200 with a structured body, not an HTTP error.
 *
 * "Blocked student" is a successful verification that answered no — it is
 * information, not a fault. Using 4xx would make the scanner's offline queue
 * treat a legitimate refusal as a failed request worth retrying, and it would
 * be retried forever.
 */
const schema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("QR"),
    token: z.string().min(1).max(2048),
    deviceId: z.string().max(120).optional(),
  }),
  z.object({
    mode: z.literal("MANUAL"),
    rollNumber: z.string().trim().min(1).max(40),
    mealSlot: z.enum(["BREAKFAST", "LUNCH", "SNACKS", "DINNER"]),
    reason: z.string().trim().min(3).max(500),
    deviceId: z.string().max(120).optional(),
  }),
]);

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", message: "Sign in again." },
      { status: 401 },
    );
  }
  if (user.role !== "STAFF" && user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { ok: false, code: "FORBIDDEN", message: "Only counter staff can verify meals." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "VALIDATION_FAILED", message: "Malformed request." },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION_FAILED", message: "Check the scan details." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const repos = createRepositories(supabase, admin);

  // The client's device id is a **label for the audit trail only**. It must
  // never key the rate limit: anything the caller controls can be varied per
  // request, so a runaway loop would simply mint a new bucket each time and the
  // limit would never bite. The counter identity that cannot be forged is the
  // signed-in staff account.
  const deviceId = parsed.data.deviceId ?? null;

  const allowed = await repos.rateLimiter.consume(
    rateLimitBuckets.qrVerify(user.tenantId, user.actorProfileId),
    60,
    240,
  );
  if (!allowed) {
    return NextResponse.json(
      { ok: false, code: "RATE_LIMITED", message: "Too many scans. Wait a moment." },
      { status: 200 },
    );
  }

  const ctx = {
    tenantId: user.tenantId,
    tenantSlug: user.tenantSlug,
    timezone: user.timezone,
    actorProfileId: user.actorProfileId,
    role: user.role,
  };

  const deps = {
    tenants: repos.tenants,
    students: repos.students,
    attendance: repos.attendance,
    messCuts: repos.messCuts,
    audit: repos.audit,
    signer: hmacTokenSigner,
    now: () => new Date(),
  };

  const result =
    parsed.data.mode === "QR"
      ? await verifyQrAttendance(ctx, { token: parsed.data.token, deviceId }, deps)
      : await verifyManualAttendance(
          ctx,
          {
            rollNumber: parsed.data.rollNumber,
            mealSlot: parsed.data.mealSlot,
            reason: parsed.data.reason,
            deviceId,
          },
          deps,
        );

  if (isErr(result)) {
    return NextResponse.json(
      {
        ok: false,
        code: result.error.code,
        message: result.error.message,
        details: result.error.details ?? null,
      },
      // 200: the request succeeded, the answer was no. See the note above.
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  const served = result.value;
  return NextResponse.json(
    {
      ok: true,
      code: "SERVED",
      attendanceId: served.attendanceId,
      studentId: served.studentId,
      rollNumber: served.rollNumber,
      fullName: served.fullName,
      // Staff must see this: the QR proves possession of a phone, not identity.
      photoUrl: served.photoUrl,
      mealSlot: served.mealSlot,
      serviceDate: served.serviceDate,
      servedAt: served.servedAt.toISOString(),
      // Served, but the override could not be logged. Surfaced so staff can
      // tell a supervisor rather than the gap being found in an audit later.
      ...(served.auditFailed ? { auditFailed: true } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
