#!/usr/bin/env tsx
/**
 * Proves the mobile auth endpoints (Slice 1) against a running server.
 *
 * The checks that matter most here are the ones about what the API *refuses* to
 * tell you:
 *
 *   - A wrong password and an unknown student must be **byte-identical**
 *     responses. An API is a far better enumerator than a form — it is trivial
 *     to script — so any difference between the two leaks which roll numbers and
 *     mobile numbers exist across the whole platform.
 *   - `must_change_password` must block everything except the endpoint that
 *     clears it. Blocking that one too would trap the user; blocking none of
 *     them would let an account run indefinitely on the temporary password an
 *     admin issued, derived from the student's own mobile number.
 *   - The session payload must not carry internal ids. A tenant UUID in a
 *     binary anyone can unpack invites a later endpoint to accept one back.
 *
 * Creates a disposable tenant, students and rate-limit rows, and removes all of
 * them. Never touches Campus Crave or the demo hostel.
 *
 * Usage:
 *   PROBE_BASE_URL=http://localhost:3100 npm run verify:mobile-auth
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const baseUrl = (process.env.PROBE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

const suffix = randomUUID().slice(0, 8);
const slug = `authprobe-${suffix}`;
const password = `Probe-${randomUUID()}`;
const newPassword = `Changed-${randomUUID()}`;

/** A number no real student holds, so the rate-limit bucket is ours alone. */
const probeMobile = `99${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

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

async function api(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; json: Record<string, never> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  let json: Record<string, never> = {} as Record<string, never>;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body is itself a failure the caller will report */
  }
  return { status: res.status, json };
}

async function createStaff(
  tenantId: string,
  label: string,
): Promise<{ userId: string; email: string }> {
  const email = `staff-${label}@${slug}.example.com`;
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const created = await res.json();
  if (!res.ok) throw new Error(`createUser failed: ${JSON.stringify(created)}`);

  await client.query(
    `insert into profiles (id, tenant_id, role, full_name) values ($1, $2, 'STAFF', $3)`,
    [created.id, tenantId, `Auth Probe staff ${label}`],
  );
  return { userId: created.id as string, email };
}

async function createStudent(
  tenantId: string,
  rollNumber: string,
  opts: { mustChangePassword?: boolean; phone?: string } = {},
): Promise<string> {
  const email = `${rollNumber}@${slug}.mess.invalid`;
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const created = await res.json();
  if (!res.ok) throw new Error(`createUser failed: ${JSON.stringify(created)}`);

  await client.query(
    `insert into profiles (id, tenant_id, role, full_name, phone, must_change_password)
     values ($1, $2, 'STUDENT', $3, $4, $5)`,
    [
      created.id,
      tenantId,
      `Auth Probe ${rollNumber}`,
      opts.phone ?? null,
      opts.mustChangePassword ?? false,
    ],
  );
  await client.query(
    `insert into students (tenant_id, profile_id, roll_number) values ($1, $2, $3)`,
    [tenantId, created.id, rollNumber],
  );
  return created.id as string;
}

const userIds: string[] = [];
let tenantId: string | undefined;

try {
  console.log(`\nProbing ${baseUrl}`);

  const { rows } = await client.query(
    `insert into tenants (slug, name, timezone) values ($1, $2, 'Asia/Kolkata') returning id`,
    [slug, `Auth Probe ${suffix}`],
  );
  tenantId = rows[0].id as string;
  await client.query(`insert into tenant_settings (tenant_id) values ($1)`, [tenantId]);

  const settledRoll = `ap${suffix}a`;
  const pendingRoll = `ap${suffix}b`;
  // `profiles_phone_format` allows an optional `+` and digits only — no spaces
  // or hyphens. The `mobile` generated column strips separators, but they can
  // never be stored in the first place.
  userIds.push(await createStudent(tenantId, settledRoll, { phone: `+91${probeMobile}` }));
  userIds.push(await createStudent(tenantId, pendingRoll, { mustChangePassword: true }));

  // --- 1. Sign in with a mobile number ---
  console.log("\nSigning in with a mobile number");
  const login = await api("/api/auth/login", {
    method: "POST",
    body: { identifier: probeMobile, password },
  });

  let accessToken = "";
  if (login.status === 200 && typeof login.json.accessToken === "string") {
    accessToken = login.json.accessToken;
    pass("resolved the mobile number to the roll-number auth address and issued tokens");
  } else {
    fail(`expected 200 with tokens, got ${login.status} ${JSON.stringify(login.json)}`);
  }

  const loginUser = (login.json.user ?? {}) as Record<string, unknown>;
  if (loginUser.role === "STUDENT" && loginUser.timezone === "Asia/Kolkata") {
    pass("returned the role and the mess's timezone, so the app can route and format");
  } else {
    fail(`session payload wrong: ${JSON.stringify(loginUser)}`);
  }

  if (!("tenantId" in loginUser) && !("actorProfileId" in loginUser)) {
    pass("did not leak tenantId or actorProfileId to the client");
  } else {
    fail(`payload leaked internal ids: ${JSON.stringify(loginUser)}`);
  }

  // --- 2. Wrong password and unknown student must be indistinguishable ---
  console.log("\nRefusing bad credentials without confirming who exists");
  const wrongPassword = await api("/api/auth/login", {
    method: "POST",
    body: { identifier: probeMobile, password: "definitely-not-it" },
  });
  const unknownUser = await api("/api/auth/login", {
    method: "POST",
    body: { identifier: "9000000001", password: "definitely-not-it" },
  });

  if (
    wrongPassword.status === 401 &&
    unknownUser.status === 401 &&
    JSON.stringify(wrongPassword.json) === JSON.stringify(unknownUser.json)
  ) {
    pass("a wrong password and an unknown number give byte-identical 401s");
  } else {
    fail(
      `enumerable: wrong-password ${wrongPassword.status} ${JSON.stringify(wrongPassword.json)} ` +
        `vs unknown ${unknownUser.status} ${JSON.stringify(unknownUser.json)}`,
    );
  }

  // --- 3. must_change_password gates everything but the change itself ---
  console.log("\nA student who still owes a password change");
  const pendingLogin = await api("/api/auth/login", {
    method: "POST",
    body: { identifier: `${pendingRoll}@${slug}.mess.invalid`, password },
  });
  const pendingToken = pendingLogin.json.accessToken as unknown as string;

  if (pendingLogin.status === 200 && pendingLogin.json.user?.["mustChangePassword"] === true) {
    pass("can sign in, and is told the change is required");
  } else {
    fail(`expected 200 with mustChangePassword=true, got ${JSON.stringify(pendingLogin.json)}`);
  }

  const blocked = await api("/api/me", { token: pendingToken });
  if (blocked.status === 403) {
    pass("/api/me refuses them until the password is changed");
  } else {
    fail(`expected 403 from /api/me, got ${blocked.status}`);
  }

  const changed = await api("/api/auth/change-password", {
    method: "POST",
    token: pendingToken,
    body: { password: newPassword },
  });
  if (changed.status === 200) {
    pass("change-password is reachable while the flag is set");
  } else {
    fail(
      `expected 200 from change-password, got ${changed.status} ${JSON.stringify(changed.json)}`,
    );
  }

  const afterChange = await api("/api/me", { token: pendingToken });
  if (afterChange.status === 200) {
    pass("/api/me works once the password has been chosen");
  } else {
    fail(`expected 200 from /api/me after the change, got ${afterChange.status}`);
  }

  // --- 4. /api/me carries the settings the app needs to build its shell ---
  console.log("\nBootstrapping the app");
  const me = await api("/api/me", { token: accessToken });
  if (me.status === 200 && me.json.settings && me.json.user) {
    pass("returns the session and the mess's settings in one call");
  } else {
    fail(`expected user + settings, got ${me.status} ${JSON.stringify(me.json)}`);
  }

  // --- 5. The counter endpoints ---
  console.log("\nCounter totals");
  const staff = await createStaff(tenantId, suffix);
  userIds.push(staff.userId);

  const staffLogin = await api("/api/auth/login", {
    method: "POST",
    body: { identifier: staff.email, password },
  });
  const staffToken = staffLogin.json.accessToken as unknown as string;

  const home = await api("/api/staff/home", { token: staffToken });
  if (home.status === 200 && typeof home.json.totalServed === "number") {
    pass("staff can read today's totals for their own mess");
  } else {
    fail(`expected 200 with totals, got ${home.status} ${JSON.stringify(home.json)}`);
  }

  if (typeof home.json.deviceId === "string" && `${home.json.deviceId}`.startsWith("counter-")) {
    pass("the audit device label is issued by the server, not invented by the client");
  } else {
    fail(`expected a server-issued deviceId, got ${JSON.stringify(home.json.deviceId)}`);
  }

  const studentPeek = await api("/api/staff/home", { token: accessToken });
  if (studentPeek.status === 403) {
    pass("a student cannot read how many people the mess served today");
  } else {
    fail(`expected 403 for a student, got ${studentPeek.status}`);
  }

  const counts = await api("/api/staff/counts", { token: staffToken });
  if (counts.status === 200 && Array.isArray(counts.json.slots)) {
    pass("projected-against-served comes back per meal slot");
  } else {
    fail(`expected 200 with slots, got ${counts.status} ${JSON.stringify(counts.json)}`);
  }

  // --- 5b. Counter sales, which reuse the web's Server Actions ---
  console.log("\nCounter sales");
  const sales = await api("/api/staff/sales", { token: staffToken });
  if (sales.status === 200 && Array.isArray(sales.json.openBills)) {
    pass("open bills, catalogue and today's takings load");
  } else {
    fail(`expected 200 with openBills, got ${sales.status} ${JSON.stringify(sales.json)}`);
  }

  // The real question: a Server Action invoked from a route handler. It
  // typechecks either way; only running it proves `revalidatePath` and the
  // transport-aware session hold up outside a form post.
  const made = await api("/api/staff/sales", {
    method: "POST",
    token: staffToken,
    body: { action: "createBill", fields: { personName: "Probe Guest" } },
  });
  if (made.status === 200 && typeof made.json.billId === "string") {
    pass("createBill runs as a Server Action called from a route handler");
  } else {
    fail(`expected a bill, got ${made.status} ${JSON.stringify(made.json)}`);
  }

  const madeBillId = made.json.billId as unknown as string | null;
  if (madeBillId) {
    const cancelled = await api("/api/staff/sales", {
      method: "POST",
      token: staffToken,
      body: { action: "cancelBill", billId: madeBillId },
    });
    if (cancelled.status === 200) {
      pass("cancelBill closes it again, so the probe leaves no open bill");
    } else {
      fail(`could not cancel the probe bill: ${JSON.stringify(cancelled.json)}`);
    }
  }

  const studentSales = await api("/api/staff/sales", { token: accessToken });
  if (studentSales.status === 403) {
    pass("a student cannot open the till");
  } else {
    fail(`expected 403 for a student, got ${studentSales.status}`);
  }

  // --- 6. Logout revokes the refresh token, not just the local copy ---
  console.log("\nSigning out");
  const refreshToken = login.json.refreshToken as unknown as string;
  const loggedOut = await api("/api/auth/logout", { method: "POST", token: accessToken });

  if (loggedOut.status === 200) {
    const reuse = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!reuse.ok) {
      pass("the refresh token is dead afterwards — a lifted token does not outlive the logout");
    } else {
      fail("the refresh token still works after logout; the session was never revoked");
    }
  } else {
    fail(`expected 200 from logout, got ${loggedOut.status}`);
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  for (const id of userIds) {
    await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    }).catch(() => {});
  }
  if (tenantId) await client.query(`delete from tenants where id = $1`, [tenantId]).catch(() => {});
  // Rate-limit rows are keyed by identifier, not by tenant, so deleting the
  // tenant does not take them with it.
  await client
    .query(`delete from rate_limits where bucket_key like $1`, [`login:%${probeMobile}%`])
    .catch(() => {});
  await client.end();
}

console.log(
  failures === 0
    ? "\n\x1b[32m✔ Mobile auth verified — login, gating, bootstrap and logout.\x1b[0m\n"
    : `\n\x1b[31m✖ ${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
