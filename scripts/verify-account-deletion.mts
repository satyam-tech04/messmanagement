#!/usr/bin/env tsx
/**
 * Proves account deletion (D-32) against a running server and the live schema.
 *
 * The parts worth proving are the ones a unit test cannot reach:
 *
 *   - The **partial unique index** really is the idempotency guarantee. Two
 *     confirms leave one row, in Postgres, not in a fake.
 *   - Disabling the profile really does end the session. A student who asked to
 *     be deleted and could still sign in would be the whole feature failing
 *     quietly.
 *   - Erasure **anonymises without deleting**. `profiles.id` cascades from
 *     `auth.users` and attendance cascades from `students`, so this asserts the
 *     attendance row is still there afterwards — a delete would take a mess's
 *     accounts with it and nothing in the type system would have objected.
 *   - The PostgREST embeds in the repository resolve. The generated types carry
 *     no relationships, so the joins are unchecked until something runs them.
 *
 * Creates a disposable tenant and removes it. Never touches Campus Crave, the
 * demo hostel or the QA accounts Apple review signs in with.
 *
 * Usage:
 *   PROBE_BASE_URL=http://localhost:3100 npm run verify:account-deletion
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./load-env.mjs";
import { SupabaseAccountDeletionRepository } from "../src/infra/supabase/repositories/account-deletion.repository";
import { completeAccountDeletion } from "../src/core/services/account-deletion";
import type { Database } from "../src/infra/supabase/database.types";
import type { TenantContext } from "../src/core/domain/tenant-context";

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const baseUrl = (process.env.PROBE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

const suffix = randomUUID().slice(0, 8);
const slug = `delprobe-${suffix}`;
const password = `Probe-${randomUUID()}`;
const roll = `dp${suffix}`;
/** The address `auth.users` holds; an EMAIL identifier is passed through as-is. */
const authEmail = `${roll}-${suffix}@deletionprobe.invalid`;

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

const admin = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function api(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
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
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* reported by the caller */
  }
  return { status: res.status, json };
}

let tenantId: string | undefined;
const userIds: string[] = [];

try {
  console.log(`\nProbing ${baseUrl}`);

  // --- Setup: one tenant, one student, one attendance row to protect ---
  const { rows } = await client.query(
    `insert into tenants (slug, name, timezone) values ($1, $2, 'Asia/Kolkata') returning id`,
    [slug, `Deletion Probe ${suffix}`],
  );
  tenantId = rows[0].id as string;
  await client.query(`insert into tenant_settings (tenant_id) values ($1)`, [tenantId]);

  const created = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: authEmail,
      password,
      email_confirm: true,
    }),
  }).then((r) => r.json());

  const profileId = created.id as string;
  userIds.push(profileId);

  await client.query(
    `insert into profiles (id, tenant_id, role, full_name, phone, email)
     values ($1, $2, 'STUDENT', $3, $4, $5)`,
    [profileId, tenantId, `Deletion Probe ${roll}`, "+919900000001", `${roll}@example.com`],
  );
  const studentRow = await client.query(
    `insert into students (tenant_id, profile_id, roll_number, room_number)
     values ($1, $2, $3, 'A-101') returning id`,
    [tenantId, profileId, roll],
  );
  const studentId = studentRow.rows[0].id as string;

  await client.query(
    `insert into attendance (tenant_id, student_id, service_date, meal_slot, method)
     values ($1, $2, current_date, 'LUNCH', 'QR')`,
    [tenantId, studentId],
  );

  // --- 1. The student signs in and asks to be deleted ---
  console.log("\nAsking to be deleted");
  const login = await api("/api/auth/login", {
    method: "POST",
    body: { identifier: authEmail, password },
  });
  const token = login.json.accessToken as string | undefined;
  if (!token) {
    fail(`could not sign the probe student in: ${login.status} ${JSON.stringify(login.json)}`);
    throw new Error("cannot continue without a session");
  }
  pass("probe student signed in");

  const refused = await api("/api/student/account-deletion", {
    method: "POST",
    token,
    body: { confirm: "yes please" },
  });
  if (refused.status === 400) pass("refuses anything but the typed word DELETE");
  else fail(`expected 400 for a bad confirmation, got ${refused.status}`);

  const first = await api("/api/student/account-deletion", {
    method: "POST",
    token,
    body: { confirm: "DELETE" },
  });
  if (first.status === 200 && typeof first.json.eraseBy === "string") {
    pass(`request accepted, erase by ${first.json.eraseBy}`);
  } else {
    fail(`expected 200 with eraseBy, got ${first.status} ${JSON.stringify(first.json)}`);
  }

  // 30 days on, in the tenant's own timezone.
  const expected = await client.query(
    `select ((now() at time zone 'Asia/Kolkata')::date + 30)::text as due`,
  );
  if (first.json.eraseBy === expected.rows[0].due) {
    pass("deadline is 30 days on, counted in the mess's own timezone");
  } else {
    fail(`deadline ${String(first.json.eraseBy)} is not ${expected.rows[0].due}`);
  }

  // --- 2. Access really is gone ---
  console.log("\nAccess after the request");
  const statuses = await client.query(
    `select p.status as profile_status, s.status as student_status
       from profiles p join students s on s.profile_id = p.id where p.id = $1`,
    [profileId],
  );
  if (statuses.rows[0].profile_status === "DISABLED") pass("profile is DISABLED");
  else fail(`profile status is ${statuses.rows[0].profile_status}`);
  if (statuses.rows[0].student_status === "INACTIVE") pass("student is INACTIVE");
  else fail(`student status is ${statuses.rows[0].student_status}`);

  const afterToken = await api("/api/me", { token });
  if (afterToken.status === 401) pass("the token already on the phone stops working");
  else fail(`expected 401 with the old token, got ${afterToken.status}`);

  const afterLogin = await api("/api/auth/login", {
    method: "POST",
    body: { identifier: authEmail, password },
  });
  if (afterLogin.status === 401) pass("signing in again is refused");
  else fail(`expected 401 signing in again, got ${afterLogin.status}`);

  // --- 3. A second confirm changes nothing ---
  console.log("\nRetrying the confirm");
  // The student is locked out now, so the retry is the one that matters: two
  // taps racing before the profile was disabled. Proven at the database level.
  const duplicate = await client.query(
    `insert into account_deletion_requests
       (tenant_id, profile_id, student_id, erase_by, previous_profile_status)
     values ($1, $2, $3, current_date + 30, 'ACTIVE')
     on conflict do nothing returning id`,
    [tenantId, profileId, studentId],
  );
  if (duplicate.rowCount === 0) pass("the partial unique index refuses a second open request");
  else fail("a second open request was accepted — idempotency is not enforced");

  // --- 4. The admin erases them ---
  console.log("\nErasing");
  const repo = new SupabaseAccountDeletionRepository(admin);
  const open = await repo.openRequestFor(tenantId, profileId);
  if (open) pass(`the repository's joins resolve (${open.studentName} / ${open.rollNumber})`);
  else fail("the repository could not read back the open request — check the embeds");

  const adminCtx: TenantContext = {
    tenantId,
    tenantSlug: slug,
    timezone: "Asia/Kolkata",
    actorProfileId: profileId,
    role: "ADMIN",
  };

  const done = await completeAccountDeletion(
    adminCtx,
    { requestId: open!.id, note: "probe" },
    { repo, now: () => new Date() },
  );
  if (done.ok) pass("erasure completed");
  else fail(`erasure failed: ${JSON.stringify(done.error)}`);

  const erased = await client.query(
    `select p.full_name, p.phone, p.email, p.photo_url,
            s.roll_number, s.room_number,
            (select count(*) from attendance a where a.student_id = s.id) as attendance
       from profiles p join students s on s.profile_id = p.id where p.id = $1`,
    [profileId],
  );
  const row = erased.rows[0];

  if (!row) {
    fail("the profile row is gone — erasure must anonymise, never delete");
  } else {
    if (row.full_name === "Deleted account") pass("name replaced");
    else fail(`name is still ${row.full_name}`);

    if (!row.phone && !row.email && !row.photo_url && !row.room_number) {
      pass("phone, email, photo and room are gone");
    } else {
      fail(`personal details survive: ${JSON.stringify(row)}`);
    }

    if (String(row.roll_number).startsWith("DELETED-")) pass("roll number replaced");
    else fail(`roll number is still ${row.roll_number}`);

    // The whole reason erasure anonymises instead of deleting.
    if (Number(row.attendance) === 1) pass("the attendance row survived the erasure");
    else fail(`attendance rows: ${row.attendance} — the mess has lost its records`);
  }

  const closed = await client.query(
    `select status, decided_at, decided_by from account_deletion_requests where profile_id = $1`,
    [profileId],
  );
  if (closed.rows[0]?.status === "COMPLETED" && closed.rows[0]?.decided_at) {
    pass("the request is closed, with who decided and when");
  } else {
    fail(`request is ${JSON.stringify(closed.rows[0])}`);
  }

  const again = await completeAccountDeletion(
    adminCtx,
    { requestId: open!.id },
    { repo, now: () => new Date() },
  );
  if (!again.ok && again.error.code === "ILLEGAL_TRANSITION") pass("a second erasure is refused");
  else fail("a completed request could be erased again");
} finally {
  // --- Teardown. Deleting the auth user cascades the rest, which is exactly
  //     the cascade the feature exists to avoid triggering in production.
  for (const id of userIds) {
    await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
  }
  if (tenantId) await client.query(`delete from tenants where id = $1`, [tenantId]);
  await client.end();
}

console.log(
  failures === 0
    ? `\n\x1b[32mAll checks passed.\x1b[0m\n`
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
