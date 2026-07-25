#!/usr/bin/env node
/**
 * Post-migration schema verification.
 *
 * `supabase db push` reporting "Finished" means the statements ran, not that
 * the result is what you intended. This asserts the properties the security
 * model actually depends on:
 *
 *   - every business table exists and has RLS ENABLED
 *   - every RLS-enabled table has at least one policy, EXCEPT the two that are
 *     deliberately service-role-only (a table with RLS on and no policy denies
 *     everything, which is correct there and a bug anywhere else)
 *   - the custom access token hook exists so JWTs carry tenant_id/user_role
 *   - the uniqueness constraints that provide idempotency are present
 *   - attendance is published to realtime for the live headcount
 *
 * Run after every `db:push`.
 */
import { execSync } from "node:child_process";
import pg from "pg";

const url = execSync("node scripts/db-url.mjs", { encoding: "utf8" }).trim();
const client = new pg.Client({ connectionString: url });

const EXPECTED_TABLES = [
  "tenants",
  "tenant_settings",
  "tenant_secrets",
  "profiles",
  "students",
  "audit_log",
  "plans",
  "subscriptions",
  "menus",
  "attendance",
  "mess_cuts",
  "headcount_snapshots",
  "rate_limits",
];

// RLS on, zero policies — intentional. Only the service role may touch these.
const POLICYLESS_BY_DESIGN = new Set(["tenant_secrets", "rate_limits"]);

const REQUIRED_CONSTRAINTS = [
  ["attendance", "attendance_tenant_student_date_slot_key"],
  ["menus", "menus_tenant_date_slot_key"],
  ["headcount_snapshots", "headcount_tenant_date_slot_key"],
  ["students", "students_profile_key"],
  ["tenants", "tenants_slug_key"],
];

let failures = 0;
const fail = (msg) => {
  console.error(`  \x1b[31m✖\x1b[0m ${msg}`);
  failures++;
};
const pass = (msg) => console.log(`  \x1b[32m✔\x1b[0m ${msg}`);

await client.connect();

// --- Tables + RLS ---------------------------------------------------------
console.log("\nTables and row level security");
const { rows: tables } = await client.query(
  `select c.relname as table, c.relrowsecurity as rls,
          (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname`,
);
const found = new Map(tables.map((t) => [t.table, t]));

for (const name of EXPECTED_TABLES) {
  const t = found.get(name);
  if (!t) {
    fail(`${name} — MISSING`);
    continue;
  }
  if (!t.rls) {
    fail(`${name} — RLS NOT ENABLED (every business table needs it)`);
    continue;
  }
  const count = Number(t.policies);
  if (POLICYLESS_BY_DESIGN.has(name)) {
    if (count > 0) {
      fail(`${name} — expected 0 policies (service-role only), found ${count}`);
    } else {
      pass(`${name} — RLS on, 0 policies (service-role only, by design)`);
    }
  } else if (count === 0) {
    fail(`${name} — RLS on but NO POLICY: denies all access, including your app`);
  } else {
    pass(`${name} — RLS on, ${count} policies`);
  }
}

const unexpected = tables.filter((t) => !EXPECTED_TABLES.includes(t.table));
for (const t of unexpected) fail(`unexpected table in public: ${t.table}`);

// --- Enums ----------------------------------------------------------------
console.log("\nEnum types");
const { rows: enums } = await client.query(
  `select t.typname, count(e.enumlabel) as labels
     from pg_type t join pg_enum e on e.enumtypid = t.oid
     join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' group by t.typname order by t.typname`,
);
const expectedEnums = [
  "attendance_method",
  "meal_slot",
  "mess_cut_status",
  "plan_duration",
  "profile_status",
  "student_status",
  "subscription_status",
  "tenant_status",
  "tenant_type",
  "user_role",
];
for (const name of expectedEnums) {
  const e = enums.find((x) => x.typname === name);
  e ? pass(`${name} (${e.labels} values)`) : fail(`${name} — MISSING`);
}

// --- Idempotency constraints ---------------------------------------------
console.log("\nUniqueness constraints (the idempotency guarantees)");
for (const [table, constraint] of REQUIRED_CONSTRAINTS) {
  const { rows } = await client.query(
    `select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
      where t.relname = $1 and c.conname = $2`,
    [table, constraint],
  );
  rows.length ? pass(`${table}.${constraint}`) : fail(`${table}.${constraint} — MISSING`);
}

const { rows: partial } = await client.query(
  `select 1 from pg_indexes
    where schemaname='public' and indexname='subscriptions_one_active_per_student'`,
);
partial.length
  ? pass("subscriptions_one_active_per_student (partial unique)")
  : fail("subscriptions_one_active_per_student — MISSING");

// --- Security helpers + auth hook ----------------------------------------
console.log("\nSecurity functions");
for (const [schema, fn] of [
  ["app", "current_tenant_id"],
  ["app", "current_user_role"],
  ["app", "is_admin"],
  ["app", "is_staff_or_admin"],
  ["app", "current_student_id"],
  ["app", "consume_rate_limit"],
  ["public", "custom_access_token_hook"],
]) {
  const { rows } = await client.query(
    `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = $1 and p.proname = $2`,
    [schema, fn],
  );
  rows.length ? pass(`${schema}.${fn}()`) : fail(`${schema}.${fn}() — MISSING`);
}

// --- Auth hook's read access ---------------------------------------------
// The hook runs as supabase_auth_admin and is not SECURITY DEFINER, so it needs
// an RLS policy — a GRANT alone does not bypass RLS. Without this the hook
// silently emits no claims (see migration 003).
console.log("\nAuth hook access to profiles");
const { rows: hookPolicy } = await client.query(
  `select 1 from pg_policy p
     join pg_class c on c.oid = p.polrelid
     join pg_roles r on r.oid = any(p.polroles)
    where c.relname = 'profiles' and r.rolname = 'supabase_auth_admin'`,
);
hookPolicy.length
  ? pass("supabase_auth_admin can read profiles (JWT claims will populate)")
  : fail("no RLS policy for supabase_auth_admin on profiles — JWTs will carry NO claims");

// --- RPC exposure and grants ---------------------------------------------
// The rate limiter's logic lives in `app`, which PostgREST does not expose, so
// a `public` wrapper is required for .rpc() to reach it (migration 004). It
// must be callable by service_role ONLY — a client able to call it could
// exhaust its own limit, or pass someone else's bucket key to lock that student
// out of their meal.
console.log("\nRPC exposure and grants");
for (const fn of ["consume_rate_limit", "prune_rate_limits"]) {
  const { rows } = await client.query(
    `select has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [fn],
  );
  const g = rows[0];
  if (!g) {
    fail(`public.${fn}() — MISSING (rate limiting cannot run)`);
  } else if (!g.service_role) {
    fail(`public.${fn}() — service_role cannot execute it`);
  } else if (g.authenticated || g.anon) {
    fail(
      `public.${fn}() — executable by ${g.authenticated ? "authenticated" : ""}${
        g.anon ? " anon" : ""
      }; a client could reset or weaponise its own limit`,
    );
  } else {
    pass(`public.${fn}() — service_role only`);
  }
}

// --- Realtime -------------------------------------------------------------
console.log("\nRealtime publication");
const { rows: rt } = await client.query(
  `select tablename from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'`,
);
rt.some((r) => r.tablename === "attendance")
  ? pass("attendance published (drives the live headcount)")
  : fail("attendance NOT published to supabase_realtime");

// --- Behavioural checks ---------------------------------------------------
console.log("\nConstraint behaviour");

async function expectRejection(label, sql, params = []) {
  try {
    await client.query("begin");
    await client.query(sql, params);
    await client.query("rollback");
    fail(`${label} — was ACCEPTED but should have been rejected`);
  } catch {
    await client.query("rollback");
    pass(`${label} — correctly rejected`);
  }
}

await expectRejection(
  "invalid IANA timezone",
  `insert into tenants (slug, name, timezone) values ('probe-tz','Probe','Mars/Olympus')`,
);
await expectRejection(
  "slug with an underscore (must stay hostname-safe)",
  `insert into tenants (slug, name) values ('unversity_mess','Probe')`,
);
await expectRejection(
  "qr refresh interval >= token TTL",
  `with t as (insert into tenants (slug,name) values ('probe-qr','P') returning id)
   insert into tenant_settings (tenant_id, qr_token_ttl_seconds, qr_refresh_seconds)
   select id, 30, 30 from t`,
);

// The hyphenated form must be accepted, and a name may keep its underscore
// (D-13: slug `unversity-mess`, display name `unversity_mess`). Uses a
// throwaway slug rather than the real one, which now exists from the seed —
// otherwise this asserts uniqueness rather than format.
try {
  await client.query("begin");
  await client.query(`insert into tenants (slug, name) values ($1, 'unversity_mess')`, [
    `probe-${Math.random().toString(36).slice(2, 10)}`,
  ]);
  await client.query("rollback");
  pass("hyphenated slug accepted, and a name may keep its underscore (D-13)");
} catch (e) {
  await client.query("rollback");
  fail(`hyphenated slug rejected: ${e.message}`);
}

await client.end();

console.log(
  failures === 0
    ? "\n\x1b[32m✔ Schema verified — all checks passed.\x1b[0m\n"
    : `\n\x1b[31m✖ ${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
