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

export async function POST(request: Request) {
  // Vercel Cron sends `Authorization: Bearer <secret>`; a manual run may send
  // the bare header. Accept both rather than making the runbook fiddly.
  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = bearer ?? request.headers.get("x-cron-secret");

  if (!secretMatches(provided)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  // Locking is the 12-hours-before run; the frequent refresh runs unlocked.
  const lock = url.searchParams.get("lock") === "true";

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
      { lock },
    );

    // One tenant failing must not abort the rest — a shared cron that stops at
    // the first bad tenant leaves every later hostel with no count at all.
    results.push(
      isErr(result)
        ? { tenant: tenant.slug, serviceDate, error: result.error.code }
        : {
            tenant: tenant.slug,
            serviceDate,
            locked: lock,
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
    { ok: true, ranAt: new Date().toISOString(), lock, tenants: results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
