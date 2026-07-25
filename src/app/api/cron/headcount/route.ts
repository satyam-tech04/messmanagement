/**
 * Headcount snapshot cron (§9).
 *
 * Runs for **every tenant**, each in its own timezone — a job that used the
 * server's date would snapshot the wrong day for any hostel whose local date
 * has already turned.
 *
 * Idempotent by construction: the write upserts on the unique key, and a locked
 * snapshot is skipped rather than revised. Cron will fire twice one day.
 *
 * Guarded by a secret header. Without it this endpoint would let anyone
 * enumerate tenants and read their subscriber counts.
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { snapshotHeadcount } from "@/core/services/snapshot-headcount";
import { isErr } from "@/core/result";
import { serviceDateOf } from "@/core/time";
import { cronPlanFor } from "@/lib/cron-plan";
import { serverEnv } from "@/lib/env.server";
import { createAdminClient } from "@/infra/supabase/admin";
import { createRepositories } from "@/infra/supabase/repositories";

/** Constant-time, and length-checked first because timingSafeEqual throws on a mismatch. */
function secretMatches(provided: string | null): boolean {
  if (!provided) return false;
  const expected = serverEnv.CRON_SECRET;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function run(request: Request) {
  // Vercel Cron sends `Authorization: Bearer <secret>`; a manual run may send
  // the bare header. Accept both rather than making the runbook fiddly.
  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = bearer ?? request.headers.get("x-cron-secret");

  if (!secretMatches(provided)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  // Which meal to lock comes from the schedule that fired, not a query string:
  // Vercel's docs point at `x-vercel-cron-schedule` for telling apart schedules
  // that share a path. Query parameters still win for a manual run.
  const plan = cronPlanFor({
    schedule: request.headers.get("x-vercel-cron-schedule"),
    params: url.searchParams,
  });

  const admin = createAdminClient();
  const repos = createRepositories(admin, admin);

  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, slug, timezone")
    .eq("status", "ACTIVE");

  if (error) {
    return NextResponse.json({ error: `tenant lookup failed: ${error.message}` }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const tenant of tenants ?? []) {
    // Each tenant's own local day — never the server's.
    const serviceDate = serviceDateOf(tenant.timezone, new Date());

    const result = await snapshotHeadcount(
      tenant.id,
      serviceDate,
      {
        tenants: repos.tenants,
        subscriptions: repos.subscriptions,
        messCuts: repos.messCuts,
        snapshots: repos.headcountSnapshots,
        now: () => new Date(),
      },
      { lock: plan.lock, ...(plan.slots ? { slots: plan.slots } : {}) },
    );

    // One tenant failing must not abort the rest — a shared cron that stops at
    // the first bad tenant leaves every later hostel with no count at all.
    results.push(
      isErr(result)
        ? { tenant: tenant.slug, serviceDate, error: result.error.code }
        : {
            tenant: tenant.slug,
            serviceDate,
            locked: plan.lock,
            written: result.value.written.map((w) => ({
              mealSlot: w.mealSlot,
              projectedCount: w.projectedCount,
              breakdown: w.breakdown,
            })),
            skipped: result.value.skipped,
          },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      ranAt: new Date().toISOString(),
      lock: plan.lock,
      slots: plan.slots ?? "all",
      tenants: results,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Vercel Cron triggers with a **GET**, so this is the one that actually runs in
 * production. POST is kept for manual `curl` runs, which read more naturally as
 * a command than a GET does.
 */
export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
