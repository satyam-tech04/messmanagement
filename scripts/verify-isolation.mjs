#!/usr/bin/env node
/**
 * Proves multi-tenant isolation against REAL seeded data.
 *
 * This is the Phase 0 exit criterion — "a cross-tenant query provably returns
 * nothing" — and it deliberately tests it the way an attacker would: with a
 * legitimately obtained, cryptographically valid JWT, not by inspecting policy
 * definitions. A policy that exists proves nothing; a query that comes back
 * empty does.
 *
 * The decisive case is that BOTH seeded tenants contain a student with roll
 * number CS21B001. Roll numbers are unique per tenant, not globally, so any
 * leak between them would show up here immediately.
 *
 * Requires `npm run db:seed` first.
 */
import { loadEnv } from "./load-env.mjs";

loadEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PW = "MessOS@2026";

let failures = 0;
const pass = (m) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const fail = (m) => {
  console.log(`  \x1b[31m✖\x1b[0m ${m}`);
  failures++;
};

async function signIn(email) {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${email}: ${j.error_description ?? j.msg ?? r.status}`);
  const claims = JSON.parse(Buffer.from(j.access_token.split(".")[1], "base64url").toString());
  return { token: j.access_token, claims };
}

const query = async (token, path) => {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
  });
  return { status: r.status, rows: await r.json() };
};

/**
 * Reads past RLS, to establish what each tenant ACTUALLY holds.
 *
 * Only ever used to compute the expected answer. The checks themselves run on
 * ordinary user JWTs — a service-role query proves nothing about isolation.
 */
const serviceQuery = async (path) => {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  });
  return { status: r.status, rows: await r.json() };
};

try {
  console.log("\nRoles sign in and carry the correct claims");
  const admin = await signIn("admin@unversity-mess.test");
  const staff = await signIn("staff@unversity-mess.test");
  const student = await signIn("cs21b001@unversity-mess.mess.invalid");
  const other = await signIn("admin@demo-hostel.test");

  admin.claims.user_role === "ADMIN" ? pass("admin -> ADMIN") : fail("admin role wrong");
  staff.claims.user_role === "STAFF" ? pass("staff -> STAFF") : fail("staff role wrong");
  student.claims.user_role === "STUDENT"
    ? pass("student -> STUDENT (signed in by roll number)")
    : fail("student role wrong");

  console.log("\nTenant isolation");
  admin.claims.tenant_id !== other.claims.tenant_id
    ? pass("the two tenants have distinct ids")
    : fail("tenant ids collide");

  // Compared against the truth, not against a number written here in July.
  // The counts drift every time somebody enrols a student, and a check that
  // fails for that reason teaches people to ignore it. What must hold is that
  // each tenant sees its own rows and exactly those.
  const a = await query(admin.token, "students?select=id");
  const b = await query(other.token, "students?select=id");
  const truthA = await serviceQuery(`students?select=id&tenant_id=eq.${admin.claims.tenant_id}`);
  const truthB = await serviceQuery(`students?select=id&tenant_id=eq.${other.claims.tenant_id}`);

  const sameSet = (seen, truth) => {
    const t = new Set(truth.map((r) => r.id));
    return seen.length === t.size && seen.every((r) => t.has(r.id));
  };

  a.rows.length > 0 && sameSet(a.rows, truthA.rows)
    ? pass(`tenant A sees exactly its own ${truthA.rows.length} students`)
    : fail(`A saw ${a.rows.length}, its tenant holds ${truthA.rows.length}`);
  b.rows.length > 0 && sameSet(b.rows, truthB.rows)
    ? pass(`tenant B sees exactly its own ${truthB.rows.length} students`)
    : fail(`B saw ${b.rows.length}, its tenant holds ${truthB.rows.length}`);

  // The leak this file exists to catch, stated directly rather than inferred
  // from a count: no row of B's may ever appear in A's result.
  const bIds = new Set(truthB.rows.map((r) => r.id));
  a.rows.some((r) => bIds.has(r.id))
    ? fail("tenant A can see one of tenant B's students")
    : pass("no row of tenant B appears in tenant A's result");

  const tenants = await query(admin.token, "tenants?select=slug");
  tenants.rows.length === 1 && tenants.rows[0]?.slug === "unversity-mess"
    ? pass("tenant A sees only its own tenant row")
    : fail(`A saw tenants ${JSON.stringify(tenants.rows)}`);

  console.log("\nStudents are confined to their own rows");
  const own = await query(student.token, "students?select=roll_number");
  own.rows.length === 1
    ? pass("student sees only themselves")
    : fail(`student saw ${own.rows.length}`);

  const secrets = await query(student.token, "tenant_secrets?select=qr_signing_secret");
  Array.isArray(secrets.rows) && secrets.rows.length === 0
    ? pass("student cannot read tenant_secrets")
    : fail("student read the QR signing secret");

  const audit = await query(student.token, "audit_log?select=id");
  Array.isArray(audit.rows) && audit.rows.length === 0
    ? pass("student cannot read the audit log")
    : fail("student read the audit log");

  console.log("\nCross-tenant write is refused");
  const forged = await fetch(`${url}/rest/v1/students`, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${admin.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tenant_id: other.claims.tenant_id,
      profile_id: admin.claims.sub,
      roll_number: "FORGED001",
    }),
  });
  forged.status >= 400
    ? pass(`tenant A cannot insert into tenant B (HTTP ${forged.status})`)
    : fail(`forged cross-tenant insert succeeded (HTTP ${forged.status})`);
} catch (e) {
  fail(e.message);
  console.error("\nHave you run `npm run db:seed`?");
}

console.log(
  failures === 0
    ? "\n\x1b[32m✔ Multi-tenant isolation verified against real data.\x1b[0m\n"
    : `\n\x1b[31m✖ ${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
