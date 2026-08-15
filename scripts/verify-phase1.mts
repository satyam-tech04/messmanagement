/**
 * Phase 1 exit-criteria verification.
 *
 * "The pilot hostel can run real lunch and dinner service, verified by QR, with
 * a correct headcount."
 *
 * This proves that end to end against the **live** database by driving the same
 * services the HTTP routes call — not by inspecting code. It creates its own
 * throwaway student so it never touches seeded or real rows, and cleans up
 * after itself.
 *
 * Run with: npm run verify:phase1
 */
import { loadEnv } from "./load-env.mjs";
loadEnv();

import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { issueQrToken } from "../src/core/services/issue-qr-token";
import { verifyManualAttendance, verifyQrAttendance } from "../src/core/services/verify-attendance";
import { snapshotHeadcount } from "../src/core/services/snapshot-headcount";
import { verifyToken } from "../src/core/policies/qr.policy";
import { hmacTokenSigner } from "../src/infra/crypto/hmac-signer";
import { createRepositories } from "../src/infra/supabase/repositories";
import { isErr, isOk } from "../src/core/result";
import { addDays, serviceDateOf, toServiceDate } from "../src/core/time";
import { syntheticEmailFor } from "../src/core/domain/identity";
import type { MealSlot } from "../src/core/domain/enums";

let failures = 0;
const pass = (m: string) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const fail = (m: string) => {
  console.error(`  \x1b[31m✖\x1b[0m ${m}`);
  failures++;
};
const check = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const repos = createRepositories(admin as never, admin as never);

const { data: tenant } = await admin
  .from("tenants")
  .select("id, slug, timezone")
  .eq("slug", "unversity-mess")
  .single();
if (!tenant) throw new Error("seed tenant missing — run npm run db:seed");

const today = serviceDateOf(tenant.timezone, new Date());
const ROLL = `ZZTEST${randomBytes(3).toString("hex").toUpperCase()}`;

console.log(`\nPhase 1 exit criteria — ${tenant.slug}, ${today}\n`);

// --- Set up a throwaway student so no real row is touched --------------------
const email = syntheticEmailFor(tenant.slug, ROLL.toLowerCase());
const { data: created } = await admin.auth.admin.createUser({
  email,
  password: randomBytes(12).toString("base64url"),
  email_confirm: true,
});
const userId = created!.user!.id;

await admin.from("profiles").insert({
  id: userId,
  tenant_id: tenant.id,
  role: "STUDENT",
  full_name: "Verification Probe",
  status: "ACTIVE",
  must_change_password: false,
});

const { data: student } = await admin
  .from("students")
  .insert({
    tenant_id: tenant.id,
    profile_id: userId,
    roll_number: ROLL,
    status: "ACTIVE",
    joined_at: today,
  })
  .select("id")
  .single();

// A throwaway plan of its own, covering every slot the mess serves.
//
// Picking whichever plan happened to be active made this script depend on test
// data: an admin editing the seeded plan to dinner-only made four checks fail
// while the system was behaving perfectly.
const { data: liveSettings } = await admin
  .from("tenant_settings")
  .select("meal_slots")
  .eq("tenant_id", tenant.id)
  .single();

const servedSlots = (liveSettings!.meal_slots as Array<{ slot: MealSlot }>).map((s) => s.slot);

const { data: plan } = await admin
  .from("plans")
  .insert({
    tenant_id: tenant.id,
    name: `zz-verify-${ROLL}`,
    duration_type: "MONTHLY",
    duration_days: 30,
    price_paise: 100000,
    included_meal_slots: servedSlots,
    is_active: true,
  })
  .select("id, price_paise, duration_days, included_meal_slots")
  .single();

await admin.from("subscriptions").insert({
  tenant_id: tenant.id,
  student_id: student!.id,
  plan_id: plan!.id,
  price_paise_snapshot: plan!.price_paise,
  included_meal_slots_snapshot: plan!.included_meal_slots,
  start_date: today,
  // Must extend past today: outside a meal window the QR targets the *next*
  // meal, which after the last service is tomorrow. A plan ending today would
  // correctly refuse that, and the probe would be testing its own setup.
  end_date: addDays(toServiceDate(today), 30),
  status: "ACTIVE",
});

async function cleanup() {
  await admin.from("attendance").delete().eq("student_id", student!.id);
  await admin.from("subscriptions").delete().eq("student_id", student!.id);
  await admin
    .from("headcount_snapshots")
    .delete()
    .eq("tenant_id", tenant!.id)
    .eq("service_date", today);
  await admin.from("students").delete().eq("id", student!.id);
  await admin.from("plans").delete().eq("id", plan!.id);
  await admin.from("profiles").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId).catch(() => {});
}

// Whichever meals this mess actually serves — never hard-coded, so the script
// works for a tenant that serves breakfast and snacks instead.
const PRIMARY = servedSlots[0]!;
const SECONDARY = servedSlots[1] ?? servedSlots[0]!;

try {
  const studentCtx = {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    timezone: tenant.timezone,
    actorProfileId: userId,
    role: "STUDENT" as const,
    studentId: student!.id,
  };
  const { data: staffProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("role", "STAFF")
    .single();
  const staffCtx = {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    timezone: tenant.timezone,
    actorProfileId: staffProfile!.id,
    role: "STAFF" as const,
  };

  const issueDeps = {
    tenants: repos.tenants,
    students: repos.students,
    messCuts: repos.messCuts,
    attendance: repos.attendance,
    signer: hmacTokenSigner,
    now: () => new Date(),
    nonce: () => randomUUID(),
  };
  const verifyDeps = {
    tenants: repos.tenants,
    students: repos.students,
    attendance: repos.attendance,
    messCuts: repos.messCuts,
    audit: repos.audit,
    signer: hmacTokenSigner,
    now: () => new Date(),
  };

  // --- 1. QR issuance ------------------------------------------------------
  console.log("QR issuance (§6.1)");
  const issued = await issueQrToken(studentCtx, issueDeps);
  check(isOk(issued), "an eligible student is issued a signed token");

  if (isOk(issued)) {
    const settings = await repos.tenants.getSettings(tenant.id);
    const secret = await repos.tenants.getQrSigningSecret(tenant.id);
    const base = {
      expectedTenantId: tenant.id,
      settings: settings!,
      timezone: tenant.timezone,
      signer: hmacTokenSigner,
    };

    // Outside a meal window the token is minted for the *next* meal, and
    // scanning it now must be refused. Asserting a plain OK here would only
    // pass when the probe happened to run during service.
    const roundTrip = verifyToken({
      ...base,
      token: issued.value.token,
      secret: secret!,
      now: new Date(),
    });
    if (issued.value.isOpenNow) {
      check(
        isOk(roundTrip) && roundTrip.value.studentId === student!.id,
        "the token verifies during service and identifies the right student",
      );
    } else {
      check(
        isErr(roundTrip) && roundTrip.error.code === "OUTSIDE_MEAL_HOURS",
        `a token for the next meal (${issued.value.mealSlot}) is refused outside its window`,
      );
    }
    check(
      isErr(
        verifyToken({
          ...base,
          token: issued.value.token,
          secret: "x".repeat(64),
          now: new Date(),
        }),
      ),
      "a token signed with the wrong secret is rejected",
    );
    check(
      isErr(
        verifyToken({
          ...base,
          token: issued.value.token,
          secret: secret!,
          now: new Date(Date.now() + (settings!.qrTokenTtlSeconds + 5) * 1000),
        }),
      ),
      "an expired token is rejected",
    );
    check(
      issued.value.refreshSeconds < (settings?.qrTokenTtlSeconds ?? 0),
      "the screen refreshes before the token expires",
    );

    // The full scan path, not just the token: signature, window, eligibility
    // and the attendance write together.
    const scan = await verifyQrAttendance(
      staffCtx,
      { token: issued.value.token, deviceId: "probe-counter" },
      verifyDeps,
    );
    if (issued.value.isOpenNow) {
      check(isOk(scan), "scanning a live token during service records attendance");
      if (isOk(scan)) {
        await admin.from("attendance").delete().eq("id", scan.value.attendanceId);
      }
    } else {
      check(
        isErr(scan) && scan.error.code === "OUTSIDE_MEAL_HOURS",
        "scanning outside the meal window is refused, and nothing is recorded",
      );
    }
  }

  // --- 2. Blocked students are denied at issuance --------------------------
  console.log("\nBlocked student (§6.1, §7.4)");
  await admin.from("students").update({ status: "BLOCKED" }).eq("id", student!.id);
  const blocked = await issueQrToken(studentCtx, issueDeps);
  check(
    isErr(blocked) && blocked.error.code === "BLOCKED_UNPAID",
    "a blocked student cannot mint a QR code",
  );
  const blockedScan = await verifyManualAttendance(
    staffCtx,
    { rollNumber: ROLL, mealSlot: PRIMARY, reason: "probe", deviceId: "probe" },
    verifyDeps,
  );
  check(
    isErr(blockedScan) && blockedScan.error.code === "BLOCKED_UNPAID",
    "the manual fallback refuses them too — it is not a bypass",
  );
  await admin.from("students").update({ status: "ACTIVE" }).eq("id", student!.id);

  // --- 3. Attendance is idempotent ----------------------------------------
  console.log("\nAttendance idempotency (§2.5)");
  const first = await verifyManualAttendance(
    staffCtx,
    { rollNumber: ROLL, mealSlot: PRIMARY, reason: "exit-criteria probe", deviceId: "probe" },
    verifyDeps,
  );
  check(isOk(first), "a student in good standing is served");

  const second = await verifyManualAttendance(
    staffCtx,
    { rollNumber: ROLL, mealSlot: PRIMARY, reason: "probe again", deviceId: "probe" },
    verifyDeps,
  );
  check(
    isErr(second) && second.error.code === "ALREADY_SERVED",
    "a second attempt at the same meal is refused",
  );

  const [a, b, c] = await Promise.all([
    verifyManualAttendance(
      staffCtx,
      { rollNumber: ROLL, mealSlot: SECONDARY, reason: "concurrent a", deviceId: "a" },
      verifyDeps,
    ),
    verifyManualAttendance(
      staffCtx,
      { rollNumber: ROLL, mealSlot: SECONDARY, reason: "concurrent b", deviceId: "b" },
      verifyDeps,
    ),
    verifyManualAttendance(
      staffCtx,
      { rollNumber: ROLL, mealSlot: SECONDARY, reason: "concurrent c", deviceId: "c" },
      verifyDeps,
    ),
  ]);
  const succeeded = [a, b, c].filter(isOk).length;
  check(
    succeeded === 1,
    `three simultaneous scans produced exactly one success (got ${succeeded})`,
  );

  const { count: rowCount } = await admin
    .from("attendance")
    .select("id", { count: "exact", head: true })
    .eq("student_id", student!.id)
    .eq("service_date", today);
  check(rowCount === 2, `exactly one row per meal exists (lunch + dinner = 2, got ${rowCount})`);

  // --- 4. Manual entries are audited --------------------------------------
  console.log("\nAudit trail (§4.4)");
  const { data: audits } = await admin
    .from("audit_log")
    .select("action, after")
    .eq("tenant_id", tenant.id)
    .eq("action", "ATTENDANCE_MANUAL_OVERRIDE")
    .order("created_at", { ascending: false })
    .limit(5);
  const probeAudit = (audits ?? []).find(
    (r) => (r.after as { rollNumber?: string })?.rollNumber === ROLL,
  );
  check(Boolean(probeAudit), "every manual override is written to the audit log with its reason");

  // --- 5. Headcount --------------------------------------------------------
  console.log("\nHeadcount (§8, §9)");
  const snapDeps = {
    tenants: repos.tenants,
    subscriptions: repos.subscriptions,
    messCuts: repos.messCuts,
    snapshots: repos.headcountSnapshots,
    now: () => new Date(),
  };

  const snap1 = await snapshotHeadcount(tenant.id, toServiceDate(today), snapDeps);
  check(isOk(snap1), "a snapshot is produced for every served meal");

  await snapshotHeadcount(tenant.id, toServiceDate(today), snapDeps);
  const { count: snapCount } = await admin
    .from("headcount_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("service_date", today);
  const slotCount = (await repos.tenants.getSettings(tenant.id))!.mealSlots.length;
  check(
    snapCount === slotCount,
    `re-running the cron does not duplicate rows (${snapCount} rows for ${slotCount} slots)`,
  );

  await snapshotHeadcount(tenant.id, toServiceDate(today), snapDeps, { lock: true });
  const lockedRow = await repos.headcountSnapshots.find(tenant.id, toServiceDate(today), PRIMARY);
  const lockedValue = lockedRow?.projectedCount ?? -1;

  // Genuinely change what the projection would be — cancelling this student's
  // subscription removes a plate — then re-run. The locked figure must ignore it.
  await admin.from("subscriptions").update({ status: "CANCELLED" }).eq("student_id", student!.id);
  await snapshotHeadcount(tenant.id, toServiceDate(today), snapDeps, { lock: true });
  const afterRow = await repos.headcountSnapshots.find(tenant.id, toServiceDate(today), PRIMARY);
  check(
    afterRow?.projectedCount === lockedValue,
    "a locked count never moves — the kitchen has already bought for it",
  );

  // --- 6. Cross-tenant isolation on the scan path --------------------------
  console.log("\nMulti-tenancy (§5, rule 8)");
  const { data: other } = await admin
    .from("tenants")
    .select("id, slug, timezone")
    .eq("slug", "demo-hostel")
    .single();

  if (other) {
    const foreignStaffCtx = { ...staffCtx, tenantId: other.id, tenantSlug: other.slug };
    const leak = await verifyManualAttendance(
      foreignStaffCtx,
      { rollNumber: ROLL, mealSlot: PRIMARY, reason: "cross-tenant probe", deviceId: "probe" },
      verifyDeps,
    );
    check(isErr(leak), "another mess cannot serve this student by roll number");
  }
} finally {
  await cleanup();
  console.log("\nprobe data removed");
}

console.log(
  failures === 0
    ? "\n\x1b[32m✔ Phase 1 exit criteria met.\x1b[0m\n"
    : `\n\x1b[31m✖ ${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
