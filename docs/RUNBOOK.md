# Runbook

Operational procedures. Written for the case where something is broken at 7pm with a queue
of students at the counter.

---

## 1. First-time setup

```bash
npm install
cp .env.example .env           # fill in the values below
```

### Where each value comes from

| Variable                        | Source                                                         |
| ------------------------------- | -------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase dashboard → Project Settings → API → Project URL      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page → `anon` `public` key                                |
| `SUPABASE_SERVICE_ROLE_KEY`     | same page → `service_role` key. **Server-only. Bypasses RLS.** |
| `SUPABASE_PROJECT_REF`          | the subdomain in your project URL                              |
| `SUPABASE_DB_PASSWORD`          | Project Settings → Database → password you set at creation     |
| `QR_SIGNING_SECRET`             | `openssl rand -base64 48`                                      |
| `CRON_SECRET`                   | `openssl rand -base64 32`                                      |

> If `SUPABASE_SERVICE_ROLE_KEY` ever appears in a client bundle or a `NEXT_PUBLIC_`
> variable, treat it as fully compromised: rotate it in the dashboard immediately. It reads
> and writes every tenant's data with RLS disabled.

---

## 2. Applying a migration

There is **no local database** in this setup (decision D-04) — `db push` writes to the live
project. Treat every push as a production change.

```bash
npm run db:dry       # connect and list what WOULD apply — always do this first
npm run db:push      # apply pending migrations
npm run db:seal      # mark them immutable — do not skip
npm run db:types     # regenerate database.types.ts
npm run typecheck    # schema drift surfaces here
npm run db:verify    # assert RLS, constraints, enums AND that JWTs carry claims
```

### Connection: use the pooler, not the direct host

`db:push` goes through `scripts/db-url.mjs`, which builds the connection string
from `SUPABASE_DB_PASSWORD`. Two things it handles that cost real debugging time:

- **Supabase's direct host (`db.<ref>.supabase.co:5432`) is IPv6-only.** This
  project's network routes IPv6 for HTTPS but not for TCP 5432, so direct
  connections fail with `no route to host` — which reads like a firewall problem
  rather than an address-family one. The script uses the **IPv4 session-mode
  pooler** (`aws-1-ap-south-1.pooler.supabase.com:5432`, user
  `postgres.<ref>`) instead.
- **Session mode (5432), never transaction mode (6543).** Migrations run DDL in
  multi-statement transactions, which transaction pooling does not support.
- The password is percent-encoded. An unencoded `@`, `#`, `/` or `:` produces a
  malformed URL and a misleading host-parse error instead of "bad password".

If the pooler region ever changes, override `SUPABASE_DB_REGION` /
`SUPABASE_DB_POOLER_PREFIX` in `.env`. The dashboard shows the current
value under **Connect → Session pooler**.

Commit the migration, `supabase/migration-checksums.json` and
`src/infra/supabase/database.types.ts` **together**. A migration
without its regenerated types is how schema drift gets past review.

### Before pushing, check

- [ ] Every new table has `tenant_id UUID NOT NULL REFERENCES tenants(id)`
- [ ] Every new table has `ENABLE ROW LEVEL SECURITY` **and** at least one policy
      (RLS enabled with no policy silently denies everything — including to your own app)
- [ ] Every new index leads with `tenant_id`
- [ ] Money columns are `BIGINT` paise, never `numeric` or `float`
- [ ] The change is additive. Dropping or renaming a column that live code reads is a
      two-deploy operation: add new → deploy code that writes both → backfill → deploy code
      that reads new → drop old.

### If a migration fails halfway

Supabase applies each migration in a transaction, so a failed one rolls back and is not
recorded. Fix the SQL **in the same file** (it never reached the database, so
`check-migrations.mjs` still has it as `pending`) and push again.

If it partially applied because it contained a non-transactional statement (e.g.
`CREATE INDEX CONCURRENTLY`), write a **new** corrective migration. Never edit the file.

---

## 3. Counter is down during service

Triage in this order — the goal is to keep the queue moving, not to diagnose.

1. **Scanner shows `NETWORK_ERROR`.** Scans queue locally and sync on reconnect. Keep
   scanning. The uniqueness constraint makes the replay safe.
2. **Scanner won't load at all.** Use `/staff/manual` on any device that has a connection:
   look the student up by roll number, mark attendance with a reason code. Every manual
   entry is audit-logged and surfaces on the admin dashboard.
3. **Nothing works.** Take attendance on paper with roll numbers, enter it through
   `/staff/manual` afterwards. Attendance is idempotent per
   `(tenant, student, service_date, meal_slot)`, so a duplicate entry cannot double-count.

**Never** disable QR validation to "get through service." Fail closed — the manual path
exists precisely so that the security path never needs weakening.

---

## 4. Reading the scanner's error states

Each has a distinct colour and sound so staff never debug at the counter.

| State                | Meaning                                       | Counter action                        |
| -------------------- | --------------------------------------------- | ------------------------------------- |
| `ALREADY_SERVED`     | This student already ate this meal            | Refuse; check the timestamp shown     |
| `NO_ACTIVE_PLAN`     | No active subscription covering today         | Send to admin                         |
| `BLOCKED_UNPAID`     | Past grace period with an outstanding balance | Send to admin (Phase 2)               |
| `ON_MESS_CUT`        | Student has an approved cut for this slot     | Refuse; they opted out (Phase 2)      |
| `OUTSIDE_MEAL_HOURS` | Scan is outside the tenant's meal window      | Check the clock / meal window setting |
| `EXPIRED_TOKEN`      | QR older than its TTL — usually a screenshot  | Ask them to refresh their app screen  |
| `INVALID_TOKEN`      | Signature failed — forged or wrong tenant     | Refuse; report to admin               |
| `NETWORK_ERROR`      | Server unreachable                            | Keep scanning; scans queue and sync   |

---

## 5. Rotating a compromised secret

**QR signing secret** — per tenant, stored server-side. Rotating invalidates every
outstanding token; students' screens refresh within one TTL, so do it between meals rather
than during service.

**Service role key** — rotate in the Supabase dashboard, update the Vercel env var, redeploy.
The app is down for the length of the redeploy, so prefer between meals.

---

## 6. Deploy

Vercel, `main` branch. CI must be green (typecheck, lint, format, tests with the 95% domain
coverage threshold, migration immutability, build).

Set every variable from `.env.example` in the Vercel project settings. `NEXT_PUBLIC_*`
values are embedded in the client bundle at build time — changing one requires a redeploy,
not just an env update.

---

## 7. Health checks after any deploy

Run these against production. They take about two minutes and cover the paths that fail
silently.

- [ ] Log in as each of the three roles; each lands on its own shell
- [ ] A student's QR screen renders and visibly refreshes within its rotation interval
- [ ] Scan one student successfully — name and photo appear on the scanner
- [ ] Scan the same student again — `ALREADY_SERVED`, and no second attendance row exists
- [ ] Today's menu renders on the student surface
- [ ] The live headcount on the staff dashboard moves when a scan succeeds

---

## Headcount snapshot cron

`POST /api/cron/headcount` projects and persists the count the kitchen cooks to,
for **every active tenant**, each in its own timezone.

| Query        | Effect                                                          |
| ------------ | --------------------------------------------------------------- |
| _(none)_     | Refresh the projection. Locked snapshots are left alone.        |
| `?lock=true` | Freeze the count. Later runs will not change a locked snapshot. |

**Authentication.** Send the shared secret as either
`Authorization: Bearer $CRON_SECRET` (what Vercel Cron sends) or `x-cron-secret`.
Compared in constant time. Without the guard, anyone could enumerate tenants and
read their subscriber counts.

```bash
curl -X POST "$NEXT_PUBLIC_APP_URL/api/cron/headcount" \
  -H "x-cron-secret: $CRON_SECRET"
```

### The schedules are UTC — this matters

Vercel Cron expressions are evaluated in **UTC**, while the lock must land
12 hours before each meal in the _tenant's_ local time (§9). For the IST pilot
tenant (UTC+5:30):

| Meal   | Opens (IST) | Lock at (IST) | Cron (UTC)    |
| ------ | ----------- | ------------- | ------------- |
| Lunch  | 12:00       | 00:00         | `30 18 * * *` |
| Dinner | 19:30       | 07:30         | `0 2 * * *`   |

Plus an hourly unlocked refresh so a student who joins mid-morning is counted.

**Onboarding a tenant in a different timezone means revisiting `vercel.json`.**
The job itself is timezone-correct — it derives each tenant's own service date —
but _when the lock fires_ is a single global schedule. A mess in another zone
would get its count locked at the wrong hour. Fixing that properly means either
per-tenant scheduling or locking based on each tenant's next meal window rather
than the clock; both are out of MVP scope with one pilot hostel.

### Re-running is safe

The write upserts on `(tenant_id, service_date, meal_slot)`, and a locked
snapshot is skipped rather than revised — once the kitchen has bought
ingredients against a number, that number must not move. One tenant failing does
not abort the rest.
