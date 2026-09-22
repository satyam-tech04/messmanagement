/**
 * Where to push, and where to stop pushing (D-34).
 *
 * The app registers on every launch, not only when the token changes: FCM
 * reissues tokens quietly, and a token that was never re-registered is a
 * student who silently stops hearing anything. The write is an upsert keyed on
 * the token, so registering fifty times leaves one row.
 *
 * `tenant_id` comes from the session, never the body. A token is a thing you
 * can send a message to, and accepting a tenant from the client would let one
 * mess push into another's students' phones.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseDeviceTokenRepository } from "@/infra/supabase/repositories";

const registerSchema = z.object({
  // FCM tokens are long and opaque; the bound matches the column's constraint.
  token: z.string().trim().min(10).max(512),
  platform: z.enum(["IOS", "ANDROID"]),
  appBuild: z.number().int().min(0).max(1_000_000).nullable().default(null),
});

const forgetSchema = z.object({
  token: z.string().trim().min(10).max(512),
});

function fail(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);
  const { user } = auth.caller;

  // Students only (D-34). Counter staff are looking at the scanner during
  // service, and a token stored for them would be one nothing ever sends to.
  if (user.role !== "STUDENT") {
    return NextResponse.json({ registered: false }, { headers: { "Cache-Control": "no-store" } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_FAILED", "Malformed request.", 400);
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return fail("VALIDATION_FAILED", "That device could not be read.", 400);

  try {
    await new SupabaseDeviceTokenRepository(createAdminClient()).register({
      tenantId: user.tenantId,
      profileId: user.actorProfileId,
      token: parsed.data.token,
      platform: parsed.data.platform,
      appBuild: parsed.data.appBuild,
    });
  } catch {
    // Never fatal to the app. A student whose token failed to register still
    // has a working app; they just do not get notifications this session.
    return fail("INFRASTRUCTURE_ERROR", "Could not register this device.", 503);
  }

  return NextResponse.json({ registered: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_FAILED", "Malformed request.", 400);
  }

  const parsed = forgetSchema.safeParse(body);
  if (!parsed.success) return fail("VALIDATION_FAILED", "That device could not be read.", 400);

  // Deleted by token alone: the caller is giving up a device they are holding,
  // and a signed-out phone that kept receiving a previous user's notifications
  // is the failure this prevents.
  await new SupabaseDeviceTokenRepository(createAdminClient()).forget(parsed.data.token);

  return NextResponse.json({ forgotten: true }, { headers: { "Cache-Control": "no-store" } });
}
