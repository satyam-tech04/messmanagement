#!/usr/bin/env tsx
/**
 * Creates one ADMIN, one STAFF and one STUDENT per tenant, on a shared known
 * password, for exercising the mobile app against real tenants.
 *
 * Usage:
 *   npm run create:test-accounts                      # every safe tenant
 *   npm run create:test-accounts -- --tenant demo-hostel
 *
 * Idempotent. Re-running resets the three accounts back to the known password
 * rather than creating duplicates, so it is also the way to recover an account
 * somebody changed the password on mid-test.
 *
 * ## Why this refuses to touch some tenants
 *
 * A tenant in `PROTECTED_SLUGS` is a real mess with real students eating from
 * it. A test student there is not a harmless extra row: `students` feeds the
 * headcount projection, so the kitchen shops and cooks for a person who does
 * not exist, every day, until somebody notices. And a test ADMIN on a live
 * tenant is a standing credential — a known password with full access to real
 * students' data.
 *
 * The refusal is deliberately not a flag you can pass. A `--force` here would
 * be used exactly once, at speed, on the wrong tenant.
 */
import { createClient } from "@supabase/supabase-js";
import { syntheticEmailFor } from "../src/core/domain/identity";
import type { Database } from "../src/infra/supabase/database.types";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const db = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Live tenants with paying students. Never provisioned into. See the header.
 */
const PROTECTED_SLUGS = new Set(["campus-crave"]);

/**
 * ⚠️ This string must NOT be swept along with a product rename.
 *
 * `scripts/seed.ts` learned this the expensive way: its `DEMO_PASSWORD` was
 * rewritten by four successive renames — MessOS → CampusMeals → MealAdda →
 * MessMate → MealAdda — while the database kept the bcrypt hash from whenever
 * the seed last actually ran. Source and reality disagreed silently for weeks;
 * the file said `MealAdda@2026` and the only password that worked was
 * `MessOS@2026`.
 *
 * A password is a value that lives in a database, not a label that follows the
 * brand. If the product is renamed again, leave this alone.
 */
const TEST_PASSWORD = "MealAdda@2026";

/** Mobile numbers are matched across all tenants at login, so these must be
 *  globally unique — two students sharing one returns AMBIGUOUS_MOBILE and
 *  neither can sign in. Allocated from a block nothing real uses. */
const MOBILE_BLOCK_START = 9_100_000_101;

type Role = "ADMIN" | "STAFF";

async function findUserByEmail(email: string): Promise<string | null> {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

/** Creates the auth user, or resets an existing one back to the known password. */
async function upsertUser(email: string, fullName: string): Promise<string> {
  const existing = await findUserByEmail(email);
  if (existing) {
    const { error } = await db.auth.admin.updateUserById(existing, {
      password: TEST_PASSWORD,
    });
    if (error) throw new Error(`resetting ${email}: ${error.message}`);
    return existing;
  }
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const only = argv.includes("--tenant") ? argv[argv.indexOf("--tenant") + 1] : null;

  const { data: tenants, error } = await db.from("tenants").select("id, slug, name").order("slug");
  if (error) throw error;

  const targets = (tenants ?? []).filter((t) => (only ? t.slug === only : true));

  if (only && targets.length === 0) {
    console.error(`No tenant with slug "${only}".`);
    process.exit(1);
  }

  const refused = targets.filter((t) => PROTECTED_SLUGS.has(t.slug));
  for (const t of refused) {
    console.log(`\n⛔ ${t.slug} — skipped. Live tenant; see the header of this file.`);
  }

  const safe = targets.filter((t) => !PROTECTED_SLUGS.has(t.slug));
  if (safe.length === 0) {
    console.error("\nNothing to do — every requested tenant is protected.");
    process.exit(1);
  }

  const created: {
    tenant: string;
    role: string;
    login: string;
    note: string;
  }[] = [];

  for (const [index, tenant] of safe.entries()) {
    console.log(`\n${tenant.name}  (${tenant.slug})`);

    // --- Admin and staff: they sign in with an email address ---
    for (const role of ["ADMIN", "STAFF"] as Role[]) {
      const email = `qa.${role.toLowerCase()}@${tenant.slug}.test`;
      const fullName = `QA ${role === "ADMIN" ? "Admin" : "Staff"}`;
      const userId = await upsertUser(email, fullName);

      const { error: pErr } = await db.from("profiles").upsert(
        {
          id: userId,
          tenant_id: tenant.id,
          role,
          full_name: fullName,
          email,
          status: "ACTIVE",
          // No forced change: the whole point is a password that keeps working.
          must_change_password: false,
        },
        { onConflict: "id" },
      );
      if (pErr) throw new Error(`${role} profile ${email}: ${pErr.message}`);

      console.log(`  ${role.padEnd(7)} ${email}`);
      created.push({ tenant: tenant.slug, role, login: email, note: "" });
    }

    // --- Student: signs in with a mobile number, not the roll number ---
    const rollNumber = "QA001";
    const mobile = String(MOBILE_BLOCK_START + index * 100);
    const studentEmail = syntheticEmailFor(tenant.slug, rollNumber);
    const studentId = await upsertUser(studentEmail, "QA Student");

    const { error: spErr } = await db.from("profiles").upsert(
      {
        id: studentId,
        tenant_id: tenant.id,
        role: "STUDENT",
        full_name: "QA Student",
        // `profiles.mobile` is generated from this and is what login matches
        // on. Without it the student cannot sign in at all.
        // No spaces or punctuation: profiles_phone_format is ^\+?[0-9]{7,15}$.
        phone: mobile,
        status: "ACTIVE",
        must_change_password: false,
      },
      { onConflict: "id" },
    );
    if (spErr) throw new Error(`student profile ${studentEmail}: ${spErr.message}`);

    const { error: stErr } = await db.from("students").upsert(
      {
        tenant_id: tenant.id,
        profile_id: studentId,
        roll_number: rollNumber,
        block: "QA",
        room_number: "001",
        status: "ACTIVE",
      },
      { onConflict: "profile_id" },
    );
    if (stErr) throw new Error(`student ${rollNumber}: ${stErr.message}`);

    console.log(`  STUDENT ${mobile}   (roll ${rollNumber}, ${studentEmail})`);
    created.push({
      tenant: tenant.slug,
      role: "STUDENT",
      login: mobile,
      note: `roll ${rollNumber}`,
    });
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`Password for all ${created.length} accounts: ${TEST_PASSWORD}`);
  console.log("=".repeat(70));
  console.log(
    "\nThe student has no subscription yet, so a QR scan will be refused with\n" +
      "NO_ACTIVE_PLAN. Give them a plan in the admin console to test attendance.",
  );
}

main().catch((e) => {
  console.error("\n✖ Failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
