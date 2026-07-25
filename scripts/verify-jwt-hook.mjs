#!/usr/bin/env node
/**
 * Proves the custom access token hook is actually live.
 *
 * The dashboard toggle says the hook is enabled; this checks that a real JWT,
 * issued by a real sign-in, actually carries `tenant_id` and `user_role`. That
 * distinction matters: if the hook is off, RLS still works via the fallback
 * profile lookup in app.current_tenant_id(), so nothing visibly breaks — you
 * just silently pay an extra query on every policy check, at 300-1000 students,
 * three times a day. Only inspecting the token catches that.
 *
 * Creates a disposable tenant + user, signs in, decodes the token, then removes
 * everything it made. Safe to run against the live project.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const suffix = randomUUID().slice(0, 8);
const email = `hookprobe-${suffix}@probe.invalid`;
const password = `Probe-${randomUUID()}`;
const slug = `hookprobe-${suffix}`;

const client = new pg.Client({
  connectionString: execSync("node scripts/db-url.mjs", { encoding: "utf8" }).trim(),
});
await client.connect();

let userId;
let tenantId;
let failures = 0;
const fail = (m) => {
  console.error(`  \x1b[31m✖\x1b[0m ${m}`);
  failures++;
};
const pass = (m) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);

try {
  // --- Arrange: a throwaway tenant and an ADMIN profile bound to it ---
  const { rows } = await client.query(
    `insert into tenants (slug, name, timezone) values ($1, $2, 'Asia/Kolkata') returning id`,
    [slug, `Hook Probe ${suffix}`],
  );
  tenantId = rows[0].id;
  await client.query(`insert into tenant_settings (tenant_id) values ($1)`, [tenantId]);

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
  if (!createRes.ok) throw new Error(`admin createUser failed: ${JSON.stringify(created)}`);
  userId = created.id;

  await client.query(
    `insert into profiles (id, tenant_id, role, full_name) values ($1, $2, 'ADMIN', 'Hook Probe')`,
    [userId, tenantId],
  );

  // --- Act: sign in the way the app will, and read the issued token ---
  const signInRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const session = await signInRes.json();
  if (!signInRes.ok) throw new Error(`sign-in failed: ${JSON.stringify(session)}`);

  const claims = JSON.parse(
    Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"),
  );

  console.log("\nJWT claims injected by the hook");

  if (claims.tenant_id === tenantId) {
    pass(`tenant_id = ${claims.tenant_id}`);
  } else {
    fail(
      `tenant_id missing or wrong (got ${JSON.stringify(claims.tenant_id)}).` +
        " The hook is NOT active — enable it at Authentication -> Hooks.",
    );
  }

  if (claims.user_role === "ADMIN") {
    pass(`user_role = ${claims.user_role}`);
  } else {
    fail(`user_role missing or wrong (got ${JSON.stringify(claims.user_role)})`);
  }

  // Supabase uses `role` for the Postgres role. Overwriting it would break
  // PostgREST authorization entirely, which is why our claim is `user_role`.
  if (claims.role === "authenticated") {
    pass(`role = "authenticated" (Postgres role left intact, as required)`);
  } else {
    fail(`role was clobbered to ${JSON.stringify(claims.role)} — this breaks PostgREST`);
  }

  // --- Act 2: RLS actually isolates, using that token ---
  console.log("\nCross-tenant isolation with a real user token");
  const readRes = await fetch(`${url}/rest/v1/tenants?select=id,slug`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` },
  });
  const visible = await readRes.json();

  if (Array.isArray(visible) && visible.length === 1 && visible[0].id === tenantId) {
    pass(`sees exactly its own tenant (1 row), not the whole table`);
  } else {
    fail(`expected exactly 1 own tenant row, got ${JSON.stringify(visible)}`);
  }
} catch (e) {
  fail(e.message);
} finally {
  // --- Clean up, even on failure ---
  if (userId) {
    await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    }).catch(() => {});
  }
  if (tenantId) await client.query(`delete from tenants where id = $1`, [tenantId]).catch(() => {});
  await client.end();
}

console.log(
  failures === 0
    ? "\n\x1b[32m✔ Auth hook verified — JWTs carry tenant_id and user_role.\x1b[0m\n"
    : `\n\x1b[31m✖ ${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
