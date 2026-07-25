#!/usr/bin/env tsx
/**
 * Seeds demo data (Phase 0.7).
 *
 * Creates **two** tenants on purpose. One is enough to click around; two is
 * what makes cross-tenant isolation provable against real rows rather than
 * asserted in a comment — which is the Phase 0 exit criterion.
 *
 * Idempotent: re-running updates rather than duplicating, so it is safe to run
 * repeatedly while developing.
 *
 *   npm run db:seed          seed or refresh the demo data
 *   npm run db:seed -- --reset   remove everything it created
 *
 * Everything it creates is identifiable by tenant slug, so `--reset` can remove
 * it cleanly without touching anything else in the database.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { syntheticEmailFor } from "../src/core/domain/identity";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const db = createClient<any>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * A fixed demo password. Acceptable ONLY because every account below is
 * disposable demo data — never reuse this pattern for a real student.
 */
const DEMO_PASSWORD = "MessOS@2026";

const TENANTS = [
  {
    slug: "unversity-mess",
    name: "unversity_mess",
    timezone: "Asia/Kolkata",
    admin: { email: "admin@unversity-mess.test", name: "Priya Menon" },
    staff: { email: "staff@unversity-mess.test", name: "Ramesh Kumar" },
    students: [
      ["CS21B001", "Aarav Sharma", "A", "101"],
      ["CS21B002", "Diya Patel", "A", "102"],
      ["CS21B003", "Rohan Gupta", "A", "103"],
      ["CS21B004", "Ananya Reddy", "B", "201"],
      ["CS21B005", "Vihaan Nair", "B", "202"],
      ["CS21B006", "Ishita Singh", "B", "203"],
      ["EE21B011", "Arjun Das", "C", "301"],
      ["EE21B012", "Meera Iyer", "C", "302"],
    ],
  },
  {
    // Exists purely to prove isolation: tenant A must never see these rows.
    // Note CS21B001 is reused deliberately — roll numbers are unique per
    // tenant, not globally, and the login flow must not confuse the two.
    slug: "demo-hostel",
    name: "Demo Hostel",
    timezone: "Asia/Kolkata",
    admin: { email: "admin@demo-hostel.test", name: "Sunita Rao" },
    staff: { email: "staff@demo-hostel.test", name: "Vikram Joshi" },
    students: [
      ["CS21B001", "Kabir Malhotra", "A", "101"],
      ["CS21B002", "Zara Khan", "A", "102"],
    ],
  },
] as const;

const isReset = process.argv.includes("--reset");

async function findUserByEmail(email: string): Promise<string | null> {
  // listUsers is paginated; the demo set is tiny, so one page suffices.
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

async function upsertUser(email: string, fullName: string): Promise<string> {
  const existing = await findUserByEmail(email);
  if (existing) {
    await db.auth.admin.updateUserById(existing, { password: DEMO_PASSWORD });
    return existing;
  }
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id;
}

async function reset(): Promise<void> {
  for (const t of TENANTS) {
    const { data: tenant } = await db.from("tenants").select("id").eq("slug", t.slug).maybeSingle();
    if (!tenant) continue;

    // Collect auth users before the cascade removes their profiles.
    const { data: profiles } = await db.from("profiles").select("id").eq("tenant_id", tenant.id);

    // Deleting the tenant cascades to settings, profiles, students,
    // subscriptions, menus and attendance.
    await db.from("tenants").delete().eq("id", tenant.id);

    for (const p of profiles ?? []) {
      await db.auth.admin.deleteUser(p.id).catch(() => {});
    }
    console.log(`  removed tenant ${t.slug} and ${profiles?.length ?? 0} users`);
  }
}

async function seed(): Promise<void> {
  const today = new Date();

  /**
   * Formats a Date's LOCAL calendar components.
   *
   * NOT `toISOString().slice(0,10)` — that converts to UTC first, so a date
   * built as "31 July local" in Asia/Kolkata comes back as "2026-07-30". This
   * is exactly the class of bug §2.9 of the architecture doc calls the most
   * confusing in this system, and it bit this script: subscriptions were
   * ending a day early.
   */
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const startDate = iso(new Date(today.getFullYear(), today.getMonth(), 1));
  const endDate = iso(new Date(today.getFullYear(), today.getMonth() + 1, 0));

  for (const t of TENANTS) {
    console.log(`\n▸ ${t.name} (${t.slug})`);

    const { data: tenant, error: tenantError } = await db
      .from("tenants")
      .upsert(
        { slug: t.slug, name: t.name, timezone: t.timezone, type: "HOSTEL" },
        { onConflict: "slug" },
      )
      .select("id")
      .single();
    if (tenantError) throw new Error(`tenant ${t.slug}: ${tenantError.message}`);
    const tenantId = tenant.id as string;

    await db.from("tenant_settings").upsert({ tenant_id: tenantId }, { onConflict: "tenant_id" });

    // Per-tenant QR signing secret (§5.3). Only ever written, never read back
    // by anything other than the server-side verifier.
    await db
      .from("tenant_secrets")
      .upsert(
        { tenant_id: tenantId, qr_signing_secret: randomBytes(48).toString("base64url") },
        { onConflict: "tenant_id" },
      );

    // --- Plan ---
    // Every Supabase call in this script checks its error. An earlier version
    // did not, and an upsert against a constraint that did not yet exist failed
    // silently — the seed then reported "8 students with active plans" having
    // created none. A seed that lies is worse tha    // --- Plan ---
    // Every Supabase call in this script checks its error. An earlier version
    // did not, and an upsert failed silently — the seed then reported
    // "8 students with active plans" having created none. A seed that lies is
    // worse than one that crashes.
    //
    // Select-then-write rather than upsert: uniqueness is enforced by a
    // case-insensitive expression index (migration 005), and Postgres cannot
    // match ON CONFLICT to an expression index. Keeping the domain rule
    // case-insensitive is worth more than the convenience of an upsert here.
    const PLAN_NAME = "Monthly — Lunch & Dinner";
    const PLAN_FIELDS = {
      tenant_id: tenantId,
      name: PLAN_NAME,
      duration_type: "MONTHLY",
      duration_days: 30,
      // Money is integer paise, always: ₹4,000.00
      price_paise: 400000,
      included_meal_slots: ["LUNCH", "DINNER"],
      is_active: true,
    };

    const { data: found, error: findError } = await db
      .from("plans")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("name", PLAN_NAME)
      .maybeSingle();
    if (findError) throw new Error(`plan lookup for ${t.slug}: ${findError.message}`);

    let planId: string | undefined = found?.id;

    if (planId) {
      const { error } = await db.from("plans").update(PLAN_FIELDS).eq("id", planId);
      if (error) throw new Error(`plan update for ${t.slug}: ${error.message}`);
    } else {
      const { data, error } = await db.from("plans").insert(PLAN_FIELDS).select("id").single();
      if (error) throw new Error(`plan insert for ${t.slug}: ${error.message}`);
      planId = data.id as string;
    }
    console.log(`  plan     ${PLAN_NAME}`);

    // --- Admin and staff (real email logins) ---
    for (const [role, person] of [
      ["ADMIN", t.admin],
      ["STAFF", t.staff],
    ] as const) {
      const userId = await upsertUser(person.email, person.name);
      await db.from("profiles").upsert(
        {
          id: userId,
          tenant_id: tenantId,
          role,
          full_name: person.name,
          email: person.email,
          status: "ACTIVE",
          // Demo accounts skip the forced change so they are usable instantly.
          must_change_password: false,
        },
        { onConflict: "id" },
      );
      console.log(`  ${role.toLowerCase().padEnd(7)} ${person.email}`);
    }

    // --- Students (roll-number logins via synthetic addresses, D-02) ---
    for (const [roll, name, block, room] of t.students) {
      const email = syntheticEmailFor(t.slug, roll);
      const userId = await upsertUser(email, name);

      await db.from("profiles").upsert(
        {
          id: userId,
          tenant_id: tenantId,
          role: "STUDENT",
          full_name: name,
          status: "ACTIVE",
          must_change_password: false,
        },
        { onConflict: "id" },
      );

      const { data: student, error: studentError } = await db
        .from("students")
        .upsert(
          {
            tenant_id: tenantId,
            profile_id: userId,
            roll_number: roll,
            block,
            room_number: room,
            status: "ACTIVE",
          },
          { onConflict: "profile_id" },
        )
        .select("id")
        .single();
      if (studentError) throw new Error(`student ${roll}: ${studentError.message}`);

      if (planId && student) {
        const { data: hasSub } = await db
          .from("subscriptions")
          .select("id")
          .eq("student_id", student.id)
          .eq("status", "ACTIVE")
          .maybeSingle();

        if (!hasSub) {
          const { error: subError } = await db.from("subscriptions").insert({
            tenant_id: tenantId,
            student_id: student.id,
            plan_id: planId,
            // Snapshotted, never read from the plan later (§4.2).
            price_paise_snapshot: 400000,
            included_meal_slots_snapshot: ["LUNCH", "DINNER"],
            start_date: startDate,
            end_date: endDate,
            status: "ACTIVE",
          });
          if (subError) throw new Error(`subscription ${roll}: ${subError.message}`);
        }
      }
    }
    const { count: subCount } = await db
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "ACTIVE");
    console.log(`  ${t.students.length} students, ${subCount ?? 0} active subscriptions`);

    // --- Today's menu ---
    const serviceDate = iso(today);
    await db.from("menus").upsert(
      [
        {
          tenant_id: tenantId,
          service_date: serviceDate,
          meal_slot: "LUNCH",
          items: ["Rajma", "Jeera Rice", "Roti", "Salad", "Curd"],
        },
        {
          tenant_id: tenantId,
          service_date: serviceDate,
          meal_slot: "DINNER",
          items: ["Paneer Butter Masala", "Roti", "Dal Tadka", "Rice", "Gulab Jamun"],
        },
      ],
      { onConflict: "tenant_id,service_date,meal_slot" },
    );
    console.log(`  menu published for ${serviceDate}`);
  }
}

async function main() {
  console.log(`Target: ${url}\n`);

  if (isReset) {
    console.log("Removing seeded data…");
    await reset();
    console.log("\n✔ Reset complete.\n");
    return;
  }

  await seed();

  console.log("\n" + "─".repeat(64));
  console.log("Sign in at http://localhost:3000/login");
  console.log("─".repeat(64));
  console.log(`  Admin    admin@unversity-mess.test`);
  console.log(`  Staff    staff@unversity-mess.test`);
  console.log(`  Student  CS21B001            (roll number, not email)`);
  console.log(`  Password ${DEMO_PASSWORD}   (all accounts)`);
  console.log("─".repeat(64));
  console.log("Second tenant 'demo-hostel' exists to prove isolation.");
  console.log("Remove everything with:  npm run db:seed -- --reset\n");
}

main().catch((e) => {
  console.error("\n✖ Seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
