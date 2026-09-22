/**
 * Which notifications a student wants (D-34).
 *
 * Stored as opt-**outs**, so a kind added later arrives switched on for
 * everyone rather than silently off for every existing student — the opposite
 * default would mean shipping a notification nobody receives and nobody can
 * explain.
 *
 * The app sends the full set of switches it is showing, not a delta. A delta
 * from a screen that was opened before a new kind existed would carry an
 * opinion about something it never displayed.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { ALL_NOTIFICATION_KINDS, NotificationKind } from "@/core/policies/notification.policy";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { isPushConfigured } from "@/infra/push/fcm";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseDeviceTokenRepository } from "@/infra/supabase/repositories";

const schema = z.object({
  /** The kinds that should be ON. Anything absent is stored as an opt-out. */
  enabled: z.array(z.enum(ALL_NOTIFICATION_KINDS as [string, ...string[]])).max(16),
});

/** What each switch says on the screen. Kept beside the kinds they describe. */
const LABELS: Record<NotificationKind, { title: string; description: string }> = {
  ANNOUNCEMENT: {
    title: "Announcements",
    description: "Special meals and notices from your mess.",
  },
  ABSENCE_DECISION: {
    title: "Away requests",
    description: "When your mess approves or rejects one.",
  },
  PLAN_REMINDER: {
    title: "Plan reminders",
    description: "Before your plan ends, and when it has.",
  },
  MENU_PUBLISHED: {
    title: "New menu",
    description: "When the next days' menu is published.",
  },
};

function fail(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);
  const { user } = auth.caller;

  const optOuts = await new SupabaseDeviceTokenRepository(createAdminClient()).optOutsFor(
    user.tenantId,
    user.actorProfileId,
  );

  return NextResponse.json(
    {
      // The app hides the whole screen when this deployment cannot push at
      // all, rather than offering switches that do nothing.
      available: isPushConfigured() && user.role === "STUDENT",
      kinds: ALL_NOTIFICATION_KINDS.map((kind) => ({
        kind,
        ...LABELS[kind],
        enabled: !optOuts.includes(kind),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);
  const { user } = auth.caller;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_FAILED", "Malformed request.", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("VALIDATION_FAILED", "Those settings could not be read.", 400);

  const enabled = new Set(parsed.data.enabled);
  const optOuts = ALL_NOTIFICATION_KINDS.filter((kind) => !enabled.has(kind));

  await new SupabaseDeviceTokenRepository(createAdminClient()).setOptOuts(
    user.tenantId,
    user.actorProfileId,
    optOuts,
  );

  return NextResponse.json(
    { kinds: ALL_NOTIFICATION_KINDS.map((kind) => ({ kind, enabled: enabled.has(kind) })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
