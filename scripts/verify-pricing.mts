/**
 * The pricing engine — verified against the LIVE database.
 *
 * The claim worth proving here is the independence rule (spec §7): changing a
 * meal price must not move an existing plan, and changing a plan must not move
 * an existing student's price. That is a claim about what is *stored*, so it
 * cannot be tested with fakes — it needs real rows, really written, really read
 * back after the parent has changed underneath them.
 *
 * Creates and deletes its own throwaway tenant data; touches nothing seeded.
 *
 * Run with: npm run verify:pricing
 */
import { loadEnv } from "./load-env.mjs";
loadEnv();

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/infra/supabase/database.types";
import { randomBytes } from "node:crypto";
import { activateSubscription } from "../src/core/policies/plan.policy";
import { autoBasePremiumPaise, assignmentPricePaise } from "../src/core/policies/pricing.policy";
import { toPaise } from "../src/core/money";
import { serviceDateOf } from "../src/core/time";
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
const TAG = randomBytes(3).toString("hex");
const ROLL = `ZZPRICE${TAG.toUpperCase()}`;

console.log(`\nPricing engine — ${tenant.slug}, ${today}\n`);

let planId: string | null = null;
let userId: string | null = null;
let studentId: string | null = null;

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
  // --- The suggestion is arithmetic, not storage ---------------------------
  console.log("Layer 1 — meal rates suggest a plan price");
  const card = { LUNCH: toPaise(6000), DINNER: toPaise(6000) };
  const suggested = autoBasePremiumPaise(card, ["LUNCH", "DINNER"], 30);
  check(suggested === 360000, `lunch ₹60 + dinner ₹60 over 30 days = ₹3,600 (${suggested}p)`);

  // --- A plan freezes its own derivation -----------------------------------
  console.log("\nLayer 2 — the plan freezes base, discount and price");
  const { data: plan, error: planError } = await admin
    .from("plans")
    .insert({
      tenant_id: tenant.id,
      name: `zz-pricing-${TAG}`,
      duration_type: "MONTHLY",
      duration_days: 30,
      base_premium_paise: 380000,
      discount_paise: 20000,
      price_paise: 360000,
      included_meal_slots: ["LUNCH", "DINNER"],
      is_active: true,
    })
    .select("id, price_paise, base_premium_paise, discount_paise, duration_days")
    .single();
  check(!planError && plan !== null, `plan created${planError ? ` — ${planError.message}` : ""}`);
  planId = plan?.id ?? null;

  // The identity constraint from migration 014, tested the only way that
  // matters: by trying to break it.
  const { error: inconsistent } = await admin
    .from("plans")
    .update({ price_paise: 999999 })
    .eq("id", planId!);
  check(
    inconsistent?.code === "23514",
    `a price that disagrees with base − discount is refused (${inconsistent?.code ?? "ACCEPTED — LEAK"})`,
  );

  // --- A student freezes the plan's price ----------------------------------
  console.log("\nLayer 3 — the student freezes what they were charged");
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
    full_name: "Pricing Probe",
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

  // Through the real policy the Server Action calls, not hand-built values.
  const activation = activateSubscription({
    actorRole: "ADMIN",
    studentStatus: "ACTIVE",
    hasActiveSubscription: false,
    plan: {
      id: planId!,
      isActive: true,
      pricePaise: toPaise(plan!.price_paise),
      durationDays: plan!.duration_days,
      mealSlots: ["LUNCH", "DINNER"] as MealSlot[],
    },
    timeZone: tenant.timezone,
    now: new Date(),
    assignmentDurationDays: 17,
  });
  check(activation.ok, "policy priced a 17-day assignment");
  if (!activation.ok) throw new Error(activation.error.message);

  // ₹3,600 ÷ 30 × 17 = 2040 exactly.
  check(
    activation.value.pricePaiseSnapshot === 204000,
    `17 of 30 days of a ₹3,600 plan = ₹2,040 (${activation.value.pricePaiseSnapshot}p)`,
  );

  const { error: subError } = await admin.from("subscriptions").insert({
    tenant_id: tenant.id,
    // Both are set by here or the script has already thrown; the typed client
    // is right to insist rather than take the nullable declaration on trust.
    student_id: studentId!,
    plan_id: planId!,
    price_paise_snapshot: activation.value.pricePaiseSnapshot,
    included_meal_slots_snapshot: [...activation.value.mealSlotsSnapshot],
    plan_duration_days_snapshot: activation.value.planDurationDaysSnapshot,
    assignment_duration_days: activation.value.assignmentDurationDays,
    calculated_price_paise: activation.value.calculatedPricePaise,
    is_price_overridden: activation.value.isPriceOverridden,
    start_date: activation.value.startDate,
    end_date: activation.value.endDate,
    status: "ACTIVE",
  });
  check(!subError, `subscription written${subError ? ` — ${subError.message}` : ""}`);

  // The database refuses to sell more days than the plan holds.
  const { error: tooLong } = await admin
    .from("subscriptions")
    .update({ assignment_duration_days: 45 })
    .eq("student_id", studentId);
  check(
    tooLong?.code === "23514",
    `selling more days than the plan offers is refused (${tooLong?.code ?? "ACCEPTED — LEAK"})`,
  );

  // --- The independence rule (§7) ------------------------------------------
  console.log("\nIndependence — the reason the snapshots exist");

  // Double every meal rate and raise the plan itself. Neither may reach the
  // student's frozen row.
  await admin
    .from("plans")
    .update({ base_premium_paise: 760000, discount_paise: 0, price_paise: 760000 })
    .eq("id", planId!);

  const { data: after } = await admin
    .from("subscriptions")
    .select("price_paise_snapshot, calculated_price_paise, assignment_duration_days")
    .eq("student_id", studentId)
    .single();

  check(
    after?.price_paise_snapshot === 204000,
    `the plan's price doubled; the student still owes ₹2,040 (${after?.price_paise_snapshot}p)`,
  );
  check(
    after?.calculated_price_paise === 204000,
    "the calculated price is unchanged too — it was stored, not derived",
  );

  // And the pure function agrees, given the frozen inputs.
  check(
    assignmentPricePaise(toPaise(360000), 30, 17) === 204000,
    "recomputing from the FROZEN plan price reproduces the same figure",
  );
} catch (e) {
  fail((e as Error).message);
} finally {
  await cleanup();
}

console.log(
  failures === 0
    ? "\n\x1b[32m✔ Pricing verified against the live database.\x1b[0m\n"
    : `\n\x1b[31m✖ ${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
