/**
 * Plan reminder cron (D-34).
 *
 * Tells a student their plan is about to run out, and tells them again the day
 * it has. Both are the same failure from the counter's point of view: somebody
 * turns up, the scanner says NO_ACTIVE_PLAN, and a queue forms behind them.
 *
 * Three things make this safe to run on a schedule:
 *
 *   * **Every tenant in its own timezone** (rule 9). A hostel whose local date
 *     has already turned needs a different day's answer to one whose has not.
 *   * **A civil hour, checked per tenant.** The schedule fires in UTC; whether
 *     that is a reasonable time to buzz a student is a local question, and a
 *     mess whose local time is 02:30 is skipped until the next run.
 *   * **One reminder per student per day.** The dedupe key is the student and
 *     the date, so the retry Vercel performs after a timeout sends nothing.
 *
 * Guarded by the same secret as the headcount cron: without it, anyone could
 * enumerate every mess's expiring subscriptions.
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  NotificationKind,
  deliveryKey,
  isWithinSendingHours,
} from "@/core/policies/notification.policy";
import { addDays, serviceDateOf, toServiceDate, type ServiceDate } from "@/core/time";
import { serverEnv } from "@/lib/env.server";
import { formatServiceDate } from "@/lib/format";
import { dispatchNotification } from "@/infra/notify/dispatch";
import { createAdminClient } from "@/infra/supabase/admin";

/** How many days before the end a student is warned. */
const WARN_DAYS_AHEAD = 3;

function secretMatches(provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(serverEnv.CRON_SECRET);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function run(request: Request) {
  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!secretMatches(bearer ?? request.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();

  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, slug, name, timezone")
    .eq("status", "ACTIVE");

  if (error || !tenants) {
    return NextResponse.json({ error: "Could not list tenants" }, { status: 503 });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const tenant of tenants) {
    if (!isWithinSendingHours(tenant.timezone, now)) {
      results.push({ tenant: tenant.slug, skipped: "OUTSIDE_SENDING_HOURS" });
      continue;
    }

    const today = serviceDateOf(tenant.timezone, now);
    // Ending in three days, or ended yesterday. Two specific dates rather than
    // a range, so a student hears twice in total and not every day for a week.
    const warnOn = addDays(today, WARN_DAYS_AHEAD);
    const endedOn = addDays(today, -1);

    const { data: subscriptions } = await admin
      .from("subscriptions")
      .select("id, end_date, students!inner ( id, profile_id )")
      .eq("tenant_id", tenant.id)
      .eq("status", "ACTIVE")
      .in("end_date", [warnOn, endedOn]);

    let sent = 0;

    for (const subscription of subscriptions ?? []) {
      const student = subscription.students as unknown as {
        id: string;
        profile_id: string;
      } | null;
      if (!student) continue;

      const endDate = toServiceDate(subscription.end_date);
      const ending = endDate !== endedOn;

      const outcome = await dispatchNotification(tenant.id, {
        kind: NotificationKind.PLAN_REMINDER,
        tenantName: tenant.name,
        title: ending ? "Your plan ends soon" : "Your plan has ended",
        body: ending
          ? `It runs out on ${formatServiceDate(endDate)}. Renew to keep eating.`
          : `It ended on ${formatServiceDate(endDate)}. The counter cannot serve you until it is renewed.`,
        // The student and the day: a retry of this run, or a second schedule
        // firing, finds the key taken and sends nothing.
        dedupeKey: deliveryKey(NotificationKind.PLAN_REMINDER, {
          id: student.id,
          date: today as ServiceDate,
        }),
        audience: [student.profile_id],
      });

      sent += outcome.sent;
    }

    results.push({ tenant: tenant.slug, considered: subscriptions?.length ?? 0, sent });
  }

  return NextResponse.json({ ran: true, results }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
