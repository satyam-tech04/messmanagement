/**
 * Subscription pause — verified against the LIVE database.
 *
 * Spec §19 and Case 12 are about a bypass: "the operation must be blocked even
 * if the request attempts to bypass the hidden UI." A unit test with fakes
 * cannot prove that, because the bypass depends on things fakes do not have —
 * whether PostgREST actually returns the embedded pauses, and whether RLS lets
 * the *staff* session read them. If staff cannot read `subscription_pauses`,
 * the embed comes back empty, `activePauseOn([])` returns null, and every
 * paused student is silently served. That is a fail-open on the one path where
 * §2.7 says fail closed, and it would pass every unit test in the suite.
 *
 * So this drives the real services against the real database, through the real
 * repositories, on a throwaway student it creates and deletes.
 *
 * Run with: npm run verify:pause
 */
import { loadEnv } from "./load-env.mjs";
loadEnv();

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/infra/supabase/database.types";
import { randomBytes } from "node:crypto";
import { issueQrToken } from "../src/core/services/issue-qr-token";
import { verifyManualAttendance, verifyQrAttendance } from "../src/core/services/verify-attendance";
import { hmacTokenSigner } from "../src/infra/crypto/hmac-signer";
import { createRepositories } from "../src/infra/supabase/repositories";
import { SupabaseStudentRepository } from "../src/infra/supabase/repositories";
import { isErr, isOk, unwrap } from "../src/core/result";
import { addDays, serviceDateOf, toServiceDate } from "../src/core/time";
import { syntheticEmailFor } from "../src/core/domain/identity";
import { resolveServiceState } from "../src/core/policies/menu.policy";
import type { TenantContext } from "../src/core/domain/tenant-context";
import type { MealSlot } from "../src/core/domain/enums";

let failures = 0;
const pass = (m: string) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const fail = (m: string) => {
  console.error(`  \x1b[31m✖\x1b[0m ${m}`);
  failures++;
};
const check = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const repos = createRepositories(admin as never, admin as never);

const { data: tenant } = await admin
  .from("tenants")
  .select("id, slug, timezone")
  .eq("slug", "unversity-mess")
  .single();
if (!tenant) throw new Error("seed tenant missing — run npm run db:seed");

const today = serviceDateOf(tenant.timezone, new Date());
const ROLL = `ZZPAUSE${randomBytes(3).toString("hex").toUpperCase()}`;

console.log(`\nSubscription pause — ${tenant.slug}, ${today}\n`);

// --- Throwaway student, plan and subscription -------------------------------
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
  full_name: "Pause Probe",
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

const { data: liveSettings } = await admin
  .from("tenant_settings")
  .select("meal_slots")
  .eq("tenant_id", tenant.id)
  .single();
const servedSlots = (liveSettings!.meal_slots as Array<{ slot: MealSlot }>).map((s) => s.slot);

const { data: plan, error: planError } = await admin
  .from("plans")
  .insert({
    tenant_id: tenant.id,
    name: `zz-pause-${ROLL}`,
    duration_type: "MONTHLY",
    duration_days: 30,
    price_paise: 100000,
    base_premium_paise: 100000,
    discount_paise: 0,
    included_meal_slots: servedSlots,
    is_active: true,
  })
  .select("id, price_paise, duration_days, included_meal_slots")
  .single();
if (planError) throw new Error(`throwaway plan insert failed: ${planError.message}`);

const { data: sub } = await admin
  .from("subscriptions")
  .insert({
    tenant_id: tenant.id,
    student_id: student!.id,
    plan_id: plan!.id,
    price_paise_snapshot: plan!.price_paise,
    included_meal_slots_snapshot: plan!.included_meal_slots,
    plan_duration_days_snapshot: plan!.duration_days,
    assignment_duration_days: plan!.duration_days,
    calculated_price_paise: plan!.price_paise,
    start_date: today,
    end_date: addDays(toServiceDate(today), 30),
    status: "ACTIVE",
  })
  .select("id, end_date")
  .single();

async function cleanup() {
  await admin.from("subscription_pauses").delete().eq("student_id", student!.id);
  await admin.from("attendance").delete().eq("student_id", student!.id);
  await admin.from("subscriptions").delete().eq("student_id", student!.id);
  await admin.from("students").delete().eq("id", student!.id);
  await admin.from("plans").delete().eq("id", plan!.id);
  await admin.from("profiles").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId).catch(() => {});
}

const studentCtx: TenantContext = {
  tenantId: tenant.id,
  tenantSlug: tenant.slug,
  timezone: tenant.timezone,
  actorProfileId: userId,
  role: "STUDENT",
  studentId: student!.id,
};
const staffCtx: TenantContext = {
  tenantId: tenant.id,
  tenantSlug: tenant.slug,
  timezone: tenant.timezone,
  actorProfileId: userId,
  role: "STAFF",
};

const issueDeps = {
  tenants: repos.tenants,
  students: repos.students,
  messCuts: repos.messCuts,
  attendance: repos.attendance,
  signer: hmacTokenSigner,
  now: () => new Date(),
  nonce: () => randomBytes(9).toString("base64url"),
};
const verifyDeps = { ...repos, signer: hmacTokenSigner, now: () => new Date() };

try {
  // --- Baseline: without a pause the student can mint a code ----------------
  console.log("Before any pause");
  const baseline = await issueQrToken(studentCtx, issueDeps);
  check(isOk(baseline), "student can mint a QR code");
  // Kept for the bypass test below: a token that was legitimately valid at the
  // moment it was issued, exactly like one sitting in the offline scan queue.
  const staleToken = isOk(baseline) ? unwrap(baseline).token : null;

  // --- Pause covering today -------------------------------------------------
  const { error: insertError } = await admin.from("subscription_pauses").insert({
    tenant_id: tenant.id,
    subscription_id: sub!.id,
    student_id: student!.id,
    start_date: today,
    resume_date: addDays(toServiceDate(today), 5),
    end_date_before_pause: sub!.end_date,
    computed_end_date: addDays(toServiceDate(sub!.end_date), 5),
    remarks: "probe",
    status: "ACTIVE",
  });
  check(!insertError, `pause row created${insertError ? ` — ${insertError.message}` : ""}`);

  console.log("\nWith the pause running");

  // The student's phone.
  const issued = await issueQrToken(studentCtx, issueDeps);
  check(
    isErr(issued) && issued.error.code === "SUBSCRIPTION_PAUSED",
    `phone refuses to mint a code (${isErr(issued) ? issued.error.code : "ISSUED — LEAK"})`,
  );

  // The bypass: a token minted before the pause existed, replayed at the
  // counter. This is the offline-queue case and Case 12 in one.
  //
  // Only meaningful while a counter is actually open. `verifyQrAttendance`
  // checks the meal window before it checks the student, so outside service
  // hours it returns OUTSIDE_MEAL_HOURS and the eligibility check never runs —
  // the assertion would pass for the wrong reason. Rather than pretend, the
  // probe says which case it exercised.
  const settings = await repos.tenants.getSettings(tenant.id);
  const counterOpen =
    settings !== null &&
    // `current` is undefined, not null, when every counter is shut — `!== null`
    // would be true either way and skip nothing.
    resolveServiceState({ timeZone: tenant.timezone, now: new Date(), slots: settings.mealSlots })
      .current != null;

  if (staleToken && counterOpen) {
    const scanned = await verifyQrAttendance(
      staffCtx,
      { token: staleToken, deviceId: null },
      verifyDeps,
    );
    check(
      isErr(scanned) && scanned.error.code === "SUBSCRIPTION_PAUSED",
      `counter refuses a pre-pause token (${isErr(scanned) ? scanned.error.code : "SERVED — LEAK"})`,
    );
  } else {
    console.log("  \x1b[33m—\x1b[0m counter scan not exercised: no meal window is open right now.");
    console.log("    The manual check below runs the identical checkAccountEligibility path.");
  }

  // The manual fallback must not be the documented workaround.
  const manual = await verifyManualAttendance(
    staffCtx,
    { rollNumber: ROLL, mealSlot: servedSlots[0]!, reason: "probe fallback", deviceId: null },
    verifyDeps,
  );
  check(
    isErr(manual) && manual.error.code === "SUBSCRIPTION_PAUSED",
    `manual fallback refuses (${isErr(manual) ? manual.error.code : "SERVED — LEAK"})`,
  );

  const { count } = await admin
    .from("attendance")
    .select("id", { count: "exact", head: true })
    .eq("student_id", student!.id);
  check(count === 0, `no attendance row was written (${count})`);

  // --- RLS: staff must be able to SEE the pause -----------------------------
  //
  // The quiet failure mode. If this policy were missing the embed would return
  // [], the policy would find no pause, and every check above would still pass
  // when run as the service role — while production served every paused
  // student. So this one runs on a real staff JWT.
  console.log("\nRow level security, on a real staff session");
  const staffClient = createClient<Database>(url, anon);
  const { error: signInError } = await staffClient.auth.signInWithPassword({
    email: "staff@unversity-mess.test",
    password: "MessMate@2026",
  });
  if (signInError) {
    fail(`could not sign in as staff — ${signInError.message}`);
  } else {
    const asStaff = new SupabaseStudentRepository(staffClient as never);
    const seen = await asStaff.findForVerification(tenant.id, student!.id);
    check(seen !== null, "staff session can read the student");
    check(
      Array.isArray(seen?.subscription?.pauses),
      "the embed is an ARRAY, not an object (to-many from subscriptions)",
    );
    check(
      (seen?.subscription?.pauses.length ?? 0) === 1,
      `staff session sees the pause through RLS (${seen?.subscription?.pauses.length ?? 0}) — if 0, every paused student is served`,
    );
  }
  await staffClient.auth.signOut();

  // --- The overlap constraint ----------------------------------------------
  console.log("\nDatabase constraints");
  const { error: overlapError } = await admin.from("subscription_pauses").insert({
    tenant_id: tenant.id,
    subscription_id: sub!.id,
    student_id: student!.id,
    start_date: addDays(toServiceDate(today), 2),
    resume_date: addDays(toServiceDate(today), 8),
    end_date_before_pause: sub!.end_date,
    computed_end_date: addDays(toServiceDate(sub!.end_date), 6),
    remarks: "overlapping probe",
    status: "ACTIVE",
  });
  check(
    overlapError?.code === "23P01",
    `an overlapping pause is refused by the database (${overlapError?.code ?? "ACCEPTED — LEAK"})`,
  );

  // A non-overlapping second pause is legitimate: a student may go home twice.
  const { error: laterError } = await admin.from("subscription_pauses").insert({
    tenant_id: tenant.id,
    subscription_id: sub!.id,
    student_id: student!.id,
    start_date: addDays(toServiceDate(today), 10),
    resume_date: addDays(toServiceDate(today), 12),
    end_date_before_pause: sub!.end_date,
    computed_end_date: addDays(toServiceDate(sub!.end_date), 2),
    remarks: "second trip home",
    status: "ACTIVE",
  });
  check(
    !laterError,
    `a later, non-overlapping pause is allowed${laterError ? ` — ${laterError.message}` : ""}`,
  );

  // --- Cancelling restores service -----------------------------------------
  console.log("\nAfter the pause is cancelled");
  await admin
    .from("subscription_pauses")
    .update({ status: "CANCELLED" })
    .eq("student_id", student!.id)
    .eq("start_date", today);

  const afterCancel = await issueQrToken(studentCtx, issueDeps);
  check(isOk(afterCancel), "the student can mint a code again");
} catch (e) {
  fail((e as Error).message);
} finally {
  await cleanup();
}

console.log(
  failures === 0
    ? "\n\x1b[32m✔ Subscription pause verified against the live database.\x1b[0m\n"
    : `\n\x1b[31m✖ ${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
