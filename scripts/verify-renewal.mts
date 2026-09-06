/**
 * Subscription renewal — verified against the LIVE database.
 *
 * The claim worth proving is the one that was impossible until migration 017:
 * a student can hold this term AND next term at the same time, and cannot hold
 * two that cover the same day. That is a database question, so fakes cannot
 * reach it.
 *
 * Creates and deletes its own throwaway student. Touches nothing seeded.
 *
 * Run with: npm run verify:renewal
 */
import { loadEnv } from "./load-env.mjs";
loadEnv();

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { Database } from "../src/infra/supabase/database.types";
import { activateSubscription } from "../src/core/policies/plan.policy";
import { toPaise } from "../src/core/money";
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

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const { data: tenant } = await admin
  .from("tenants")
  .select("id, slug, timezone")
  .eq("slug", "unversity-mess")
  .single();
if (!tenant) throw new Error("seed tenant missing — run npm run db:seed");

const today = serviceDateOf(tenant.timezone, new Date());
const ROLL = `ZZREN${randomBytes(3).toString("hex").toUpperCase()}`;
console.log(`\nSubscription renewal — ${tenant.slug}, ${today}\n`);

let userId: string | null = null;
let studentId: string | null = null;
let planId: string | null = null;

async function cleanup() {
  if (studentId) {
    await admin.from("subscriptions").delete().eq("student_id", studentId);
    await admin.from("students").delete().eq("id", studentId);
  }
  if (planId) await admin.from("plans").delete().eq("id", planId);
  if (userId) {
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
}

try {
  const email = syntheticEmailFor(tenant.slug, ROLL.toLowerCase());
  const { data: created } = await admin.auth.admin.createUser({
    email,
    password: randomBytes(12).toString("base64url"),
    email_confirm: true,
  });
  userId = created!.user!.id;
  await admin.from("profiles").insert({
    id: userId,
    tenant_id: tenant.id,
    role: "STUDENT",
    full_name: "Renewal Probe",
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
  studentId = student!.id;

  const { data: plan } = await admin
    .from("plans")
    .insert({
      tenant_id: tenant.id,
      name: `zz-renew-${ROLL}`,
      duration_type: "MONTHLY",
      duration_days: 30,
      price_paise: 360000,
      base_premium_paise: 360000,
      discount_paise: 0,
      included_meal_slots: ["LUNCH", "DINNER"],
      is_active: true,
    })
    .select("id, price_paise, duration_days")
    .single();
  planId = plan!.id;

  const insertTerm = async (startDate: string) =>
    admin.from("subscriptions").insert({
      tenant_id: tenant.id,
      student_id: studentId!,
      plan_id: planId!,
      price_paise_snapshot: 360000,
      included_meal_slots_snapshot: ["LUNCH", "DINNER"],
      plan_duration_days_snapshot: 30,
      assignment_duration_days: 30,
      calculated_price_paise: 360000,
      start_date: startDate,
      end_date: addDays(toServiceDate(startDate), 29),
      status: "ACTIVE",
    });

  // --- The current term -----------------------------------------------------
  console.log("The current term");
  const termStart = today;
  const termEnd = addDays(toServiceDate(today), 29);
  const { error: firstError } = await insertTerm(termStart);
  check(!firstError, `a 30-day term starting today${firstError ? ` — ${firstError.message}` : ""}`);

  // --- What migration 017 now ALLOWS ---------------------------------------
  console.log("\nRenewing early (impossible before migration 017)");
  const nextStart = addDays(toServiceDate(termEnd), 1);
  const { error: renewError } = await insertTerm(nextStart);
  check(
    !renewError,
    `next term starting ${nextStart} coexists with the current one${renewError ? ` — ${renewError.message}` : ""}`,
  );

  const { count: held } = await admin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("status", "ACTIVE");
  check(held === 2, `the student now holds two ACTIVE subscriptions back to back (${held})`);

  // --- What it still REFUSES ------------------------------------------------
  console.log("\nOverlap is still refused");
  const { error: overlapError } = await insertTerm(addDays(toServiceDate(today), 10));
  check(
    overlapError?.code === "23P01",
    `a term overlapping the current one is refused (${overlapError?.code ?? "ACCEPTED — LEAK"})`,
  );

  const { error: sameDayError } = await insertTerm(termEnd);
  check(
    sameDayError?.code === "23P01",
    `even a one-day overlap on the final day is refused (${sameDayError?.code ?? "ACCEPTED — LEAK"})`,
  );

  // --- The policy refuses first, with a usable message ----------------------
  console.log("\nThe policy catches it before the database does");
  const existingPeriods = [
    { status: "ACTIVE", startDate: toServiceDate(termStart), endDate: toServiceDate(termEnd) },
  ];
  const tooEarly = activateSubscription({
    actorRole: "ADMIN",
    studentStatus: "ACTIVE",
    existingPeriods,
    plan: {
      id: planId!,
      isActive: true,
      pricePaise: toPaise(plan!.price_paise),
      durationDays: plan!.duration_days,
      mealSlots: ["LUNCH", "DINNER"] as MealSlot[],
    },
    timeZone: tenant.timezone,
    now: new Date(),
    startDate: toServiceDate(addDays(toServiceDate(today), 5)),
  });
  check(!tooEarly.ok, "an overlapping renewal is refused by the policy");
  check(
    !tooEarly.ok && tooEarly.error.message.includes(nextStart),
    `the message names the first free date, ${nextStart}`,
  );

  // --- The lapsed student, which is the commonest renewal -------------------
  //
  // Reported as a bug: a student whose plan ran out last week got no Renew
  // control at all. The policy always allowed it; the admin screen only
  // rendered the button on a RUNNING term. These prove the underlying flow.
  console.log("\nRenewing a term that has already lapsed");

  // A second throwaway student, so this stands alone from the terms above.
  const LAPSED_ROLL = `ZZLAP${randomBytes(3).toString("hex").toUpperCase()}`;
  const { data: lapsedUser } = await admin.auth.admin.createUser({
    email: syntheticEmailFor(tenant.slug, LAPSED_ROLL.toLowerCase()),
    password: randomBytes(12).toString("base64url"),
    email_confirm: true,
  });
  const lapsedUserId = lapsedUser!.user!.id;
  await admin.from("profiles").insert({
    id: lapsedUserId,
    tenant_id: tenant.id,
    role: "STUDENT",
    full_name: "Lapsed Probe",
    status: "ACTIVE",
    must_change_password: false,
  });
  const { data: lapsedStudent } = await admin
    .from("students")
    .insert({
      tenant_id: tenant.id,
      profile_id: lapsedUserId,
      roll_number: LAPSED_ROLL,
      status: "ACTIVE",
      joined_at: today,
    })
    .select("id")
    .single();

  // A term that ran 60 days ago and finished 31 days ago.
  const lapsedStart = addDays(toServiceDate(today), -60);
  const lapsedEnd = addDays(toServiceDate(today), -31);
  await admin.from("subscriptions").insert({
    tenant_id: tenant.id,
    student_id: lapsedStudent!.id,
    plan_id: planId!,
    price_paise_snapshot: 360000,
    included_meal_slots_snapshot: ["LUNCH", "DINNER"],
    plan_duration_days_snapshot: 30,
    assignment_duration_days: 30,
    calculated_price_paise: 360000,
    start_date: lapsedStart,
    end_date: lapsedEnd,
    status: "ACTIVE",
  });

  const lapsedPeriods = [
    { status: "ACTIVE", startDate: toServiceDate(lapsedStart), endDate: toServiceDate(lapsedEnd) },
  ];
  const planShape = {
    id: planId!,
    isActive: true,
    pricePaise: toPaise(plan!.price_paise),
    durationDays: plan!.duration_days,
    mealSlots: ["LUNCH", "DINNER"] as MealSlot[],
  };

  const fromToday = activateSubscription({
    actorRole: "ADMIN",
    studentStatus: "ACTIVE",
    existingPeriods: lapsedPeriods,
    plan: planShape,
    timeZone: tenant.timezone,
    now: new Date(),
    startDate: toServiceDate(today),
  });
  check(fromToday.ok, "a lapsed term can be renewed from today");

  // "Backdate it if they have been eating since" — legal, within two limits
  // that meet in the middle: it must not reach back into days the old term
  // already covered, and the resulting term must still cover today.
  const backdated = activateSubscription({
    actorRole: "ADMIN",
    studentStatus: "ACTIVE",
    existingPeriods: lapsedPeriods,
    plan: planShape,
    timeZone: tenant.timezone,
    now: new Date(),
    startDate: toServiceDate(addDays(toServiceDate(today), -10)),
  });
  check(backdated.ok, "and backdated ten days, to cover meals already eaten");

  // Backdating a 30-day term by 31 days would produce a plan that expired
  // yesterday — the student still could not eat, so it is refused. Not the
  // overlap rule: `validateSubscriptionStart` has always caught this.
  const alreadyOver = activateSubscription({
    actorRole: "ADMIN",
    studentStatus: "ACTIVE",
    existingPeriods: lapsedPeriods,
    plan: planShape,
    timeZone: tenant.timezone,
    now: new Date(),
    startDate: toServiceDate(addDays(toServiceDate(lapsedEnd), 1)),
  });
  check(
    !alreadyOver.ok,
    "a backdated term that would already have expired is refused, not silently created",
  );

  const tooFarBack = activateSubscription({
    actorRole: "ADMIN",
    studentStatus: "ACTIVE",
    existingPeriods: lapsedPeriods,
    plan: planShape,
    timeZone: tenant.timezone,
    now: new Date(),
    startDate: toServiceDate(addDays(toServiceDate(lapsedEnd), -5)),
  });
  check(!tooFarBack.ok, "but not back into days the lapsed term already covered and was paid for");

  const { error: lapsedInsert } = await admin.from("subscriptions").insert({
    tenant_id: tenant.id,
    student_id: lapsedStudent!.id,
    plan_id: planId!,
    price_paise_snapshot: 360000,
    included_meal_slots_snapshot: ["LUNCH", "DINNER"],
    plan_duration_days_snapshot: 30,
    assignment_duration_days: 30,
    calculated_price_paise: 360000,
    start_date: today,
    end_date: addDays(toServiceDate(today), 29),
    status: "ACTIVE",
  });
  check(
    !lapsedInsert,
    `the renewal is actually written${lapsedInsert ? ` — ${lapsedInsert.message}` : ""}`,
  );

  await admin.from("subscriptions").delete().eq("student_id", lapsedStudent!.id);
  await admin.from("students").delete().eq("id", lapsedStudent!.id);
  await admin.from("profiles").delete().eq("id", lapsedUserId);
  await admin.auth.admin.deleteUser(lapsedUserId).catch(() => {});

  // --- Cancelling releases the dates ---------------------------------------
  console.log("\nCancelling frees the dates again");
  await admin
    .from("subscriptions")
    .update({ status: "CANCELLED" })
    .eq("student_id", studentId)
    .eq("start_date", nextStart);
  const { error: afterCancel } = await insertTerm(addDays(toServiceDate(termEnd), 1));
  check(
    !afterCancel,
    `the cancelled term's dates can be reused${afterCancel ? ` — ${afterCancel.message}` : ""}`,
  );
} catch (e) {
  fail((e as Error).message);
} finally {
  await cleanup();
}

console.log(
  failures === 0
    ? "\n\x1b[32m✔ Renewal verified against the live database.\x1b[0m\n"
    : `\n\x1b[31m✖ ${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
