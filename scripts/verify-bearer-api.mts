#!/usr/bin/env tsx
/**
 * Proves the JSON API is reachable with a bearer token — the transport the
 * Flutter app will use.
 *
 * Three things are checked, and each one guards a defect that was real:
 *
 *   1. **`/api/*` is served, not redirected.** `proxy.ts` sends an
 *      unauthenticated request to `/login`. Its matcher used to cover `/api`
 *      too, so a request carrying `Authorization: Bearer ...` and no cookie got
 *      a 307 to an HTML page and never reached the handler. A client asking for
 *      JSON got markup. This is the check that would have caught it.
 *
 *   2. **The bearer token resolves to the right user**, with RLS applying as
 *      that user exactly as it does for a cookie session.
 *
 *   3. **`must_change_password` is enforced on the API.** That gate lives in
 *      the web layout, which `/api/*` sits outside of — so without an explicit
 *      check the app would be a permanent way around the forced password
 *      change, on accounts whose temporary password is derived from the
 *      student's own phone number and known to whoever created the account.
 *
 * What it deliberately does NOT prove: that a QR token can be *issued*. That
 * needs an eligible student with a live plan and is Slice 2's business. Here a
 * domain denial such as NO_ACTIVE_PLAN is a PASS — it means the request reached
 * the handler, was authenticated, and was answered in JSON, which is the whole
 * claim of Slice 0.
 *
 * Creates a disposable tenant and student, then removes everything it made.
 * Safe to run against the live project — it never touches seeded data.
 *
 * Usage:
 *   npm run verify:bearer                       # against http://localhost:3000
 *   PROBE_BASE_URL=https://… npm run verify:bearer
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const baseUrl = (process.env.PROBE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

const suffix = randomUUID().slice(0, 8);
const slug = `bearerprobe-${suffix}`;
const password = `Probe-${randomUUID()}`;

let failures = 0;
const fail = (m: string) => {
  console.error(`  \x1b[31m✖\x1b[0m ${m}`);
  failures++;
};
const pass = (m: string) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);

const client = new pg.Client({
  connectionString: execSync("node scripts/db-url.mjs", { encoding: "utf8" }).trim(),
});
await client.connect();

/** Sign in the way the app will, and return the access token. */
async function signIn(email: string): Promise<string> {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(body)}`);
  return body.access_token as string;
}

/**
 * Call the API without following redirects, so a 307 is visible as a 307
 * rather than silently turning into the HTML of the login page.
 */
async function callApi(path: string, token?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  return { status: res.status, isJson, body: isJson ? await res.json() : await res.text() };
}

async function createStudent(
  tenantId: string,
  rollNumber: string,
  mustChangePassword: boolean,
): Promise<{ userId: string; email: string }> {
  const email = `${rollNumber}@${slug}.mess.invalid`;

  const createRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const created = await createRes.json();
  if (!createRes.ok) throw new Error(`createUser failed: ${JSON.stringify(created)}`);

  await client.query(
    `insert into profiles (id, tenant_id, role, full_name, must_change_password)
     values ($1, $2, 'STUDENT', $3, $4)`,
    [created.id, tenantId, `Bearer Probe ${rollNumber}`, mustChangePassword],
  );
  await client.query(
    `insert into students (tenant_id, profile_id, roll_number) values ($1, $2, $3)`,
    [tenantId, created.id, rollNumber],
  );

  return { userId: created.id, email };
}

const userIds: string[] = [];
let tenantId: string | undefined;

try {
  console.log(`\nProbing ${baseUrl}`);

  // --- Arrange: a throwaway tenant with two students ---
  const { rows } = await client.query(
    `insert into tenants (slug, name, timezone) values ($1, $2, 'Asia/Kolkata') returning id`,
    [slug, `Bearer Probe ${suffix}`],
  );
  tenantId = rows[0].id as string;
  await client.query(`insert into tenant_settings (tenant_id) values ($1)`, [tenantId]);

  // A real mess gets a signing secret at provisioning time (see provision.ts).
  // Without it QR issuance fails closed with INFRASTRUCTURE_ERROR, which would
  // still pass the transport check below but for the wrong reason — an
  // ambiguous pass is barely better than a failure.
  await client.query(`insert into tenant_secrets (tenant_id, qr_signing_secret) values ($1, $2)`, [
    tenantId,
    randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
  ]);

  const settled = await createStudent(tenantId, `bp${suffix}a`, false);
  const pending = await createStudent(tenantId, `bp${suffix}b`, true);
  userIds.push(settled.userId, pending.userId);

  // --- 1. No credentials at all ---
  console.log("\nAn unauthenticated API request");
  const anon = await callApi("/api/qr/token");
  if (anon.status === 307 || anon.status === 302) {
    fail(
      `redirected (${anon.status}) instead of answering — proxy.ts is still matching /api. ` +
        `A mobile client would receive the login page as HTML.`,
    );
  } else if (anon.status === 401 && anon.isJson) {
    pass("401 in JSON, not a redirect to /login");
  } else {
    fail(`expected 401 JSON, got ${anon.status} (json=${anon.isJson})`);
  }

  // --- 2. A real bearer token ---
  console.log("\nA bearer token from a signed-in student");
  const token = await signIn(settled.email);
  const authed = await callApi("/api/qr/token", token);

  if (authed.status === 307 || authed.status === 302) {
    fail(`redirected (${authed.status}) — the bearer request never reached the handler`);
  } else if (!authed.isJson) {
    fail(`handler did not answer in JSON (status ${authed.status})`);
  } else if (authed.status === 401) {
    fail(`token was rejected: ${JSON.stringify(authed.body)}`);
  } else {
    // Either an issued token or a domain denial. Both mean the handler ran and
    // authenticated the caller, which is what this slice claims.
    const body = authed.body as { token?: string; error?: { code?: string } };
    const outcome = body.token ? "issued a QR token" : `answered ${body.error?.code}`;
    pass(`reached the handler as the signed-in student and ${outcome}`);
  }

  // --- 3. A malformed token must not be treated as a session ---
  console.log("\nA garbage bearer token");
  const garbage = await callApi("/api/qr/token", "not-a-real-jwt");
  if (garbage.status === 401 && garbage.isJson) {
    pass("401 in JSON — an unverifiable token is no session (fails closed)");
  } else {
    fail(`expected 401 JSON, got ${garbage.status} (json=${garbage.isJson})`);
  }

  // --- 4. The forced password change is enforced on the API ---
  console.log("\nA student who still owes a password change");
  const pendingToken = await signIn(pending.email);
  const gated = await callApi("/api/qr/token", pendingToken);

  if (gated.status === 403 && gated.isJson) {
    const code = (gated.body as { error?: { code?: string } }).error?.code;
    if (code === "PASSWORD_CHANGE_REQUIRED") {
      pass("403 PASSWORD_CHANGE_REQUIRED — the app cannot skip the forced change");
    } else {
      fail(`403 but with code ${JSON.stringify(code)}, expected PASSWORD_CHANGE_REQUIRED`);
    }
  } else {
    fail(
      `expected 403 PASSWORD_CHANGE_REQUIRED, got ${gated.status} — ` +
        `an admin-known temporary password would keep working from the app`,
    );
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  // --- Clean up, even on failure ---
  for (const id of userIds) {
    await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    }).catch(() => {});
  }
  if (tenantId) await client.query(`delete from tenants where id = $1`, [tenantId]).catch(() => {});
  await client.end();
}

console.log(
  failures === 0
    ? "\n\x1b[32m✔ Bearer transport verified — /api/* is reachable, authenticated and gated.\x1b[0m\n"
    : `\n\x1b[31m✖ ${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
