@AGENTS.md

# CLAUDE.md — Mess OS

Multi-tenant SaaS for hostel mess operations. Students hold a fixed-price subscription
covering lunch and dinner; attendance is verified at the counter with a rotating,
server-signed QR code.

**Picking this up cold? Read [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) §"RESUME HERE" first** —
it carries current state, next steps in order, and the traps already discovered.

- Full architecture: [docs/mess-management-architecture.md](docs/mess-management-architecture.md)
- Phase tracker and current status: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)
- Resolved + open product decisions: [docs/DECISIONS.md](docs/DECISIONS.md)
- Runbook (env, migrations, deploy): [docs/RUNBOOK.md](docs/RUNBOOK.md)
- Bulk import / export / reporting plan: [docs/IMPORT-EXPORT.md](docs/IMPORT-EXPORT.md)
- **UI standard (read before building any screen): [docs/DESIGN.md](docs/DESIGN.md)**

**Live-client context:** a real hostel with 300–1000 students will use this three times a
day. Bugs mean students don't get fed or get double-charged. There is no staging
population to catch mistakes for you.

---

## Non-negotiable rules

### 1. Layering — dependencies point inward only

```
src/core   -> imports nothing outside src/core (no React, no Next, no Supabase)
src/infra  -> may import src/core
src/app    -> may import src/core, src/infra, src/components, src/lib
```

Enforced by ESLint `import/no-restricted-paths` + `no-restricted-imports`; CI fails on
violation. If core needs data, declare a port interface in `src/core/ports` and implement
it in `src/infra`.

### 2. No business logic in components or Server Actions

A Server Action validates input with Zod, builds a `TenantContext`, calls **one** use case
in `src/core/services`, and maps the result to a response. If you are writing
`if (daysUsed > 5)` in a `.tsx` file, it belongs in a policy.

### 3. Money is integer paise, always

`BIGINT` in Postgres, `number` of paise in TypeScript. Never float, never rupees. Format
only at the render boundary. Every currency split states its remainder strategy — the
remainder stays with the mess, so credits can never exceed what was paid.

### 4. Financial records are immutable

Never `UPDATE` a balance. Append to `ledger_entries`; balance is `SUM(...)`. Corrections
are new reversing entries. When an owner asks "this student says he paid ₹4,000 in March,"
the ledger is the answer.

### 5. Every state-changing operation is idempotent

Enforced by database constraints, not application `if` checks. Retries, double-taps,
duplicate webhooks and flaky counter Wi-Fi are guaranteed. A retried operation must produce
zero additional rows.

### 6. Explicit state machines, not boolean soup

One `status` enum per entity with documented legal transitions and a `canTransition()`
guard in core. No `is_active` + `is_blocked` + `is_paid` — that produces impossible states
nobody can reason about.

### 7. Fail closed on security and money

Can't reach the DB during QR validation? Deny the scan; staff use the audited manual
fallback. Signature unverifiable? Reject. Status indeterminate? Treat as inactive. A
wrongly-denied meal costs 20 seconds; a bypassable QR costs the product.

### 8. Multi-tenancy is a data-model property

`tenant_id` on every business table, every index, every query — enforced by RLS **and** the
application layer. RLS alone cannot express "staff may verify attendance but not issue
refunds," so do both. Never accept `tenant_id` from the client; derive it server-side.

### 9. Time is tenant-local

Store `timestamptz` (UTC). Compute `service_date` as a plain `date` **in the tenant's
timezone**. The 12-hour cutoff, "today's menu" and the daily headcount key off the hostel's
local day boundary, not UTC's. Every date derivation goes through `src/core/time`. Never
write `new Date().toISOString().slice(0, 10)`.

### 10. Validate at every boundary with Zod

Every route input, every webhook body, every env var. Parse, don't trust.

### 11. The UI bar is premium and complete

Every list is a real table with **four** designed states — loading (skeletons), empty
(with the action that fixes it), error (with a retry), and populated. Money and dates are
always formatted, never raw. Status is a badge with colour _and_ text. Dark mode and
keyboard navigation are not optional extras. Full standard: [docs/DESIGN.md](docs/DESIGN.md).

A screen with a bare "No data" message or an unhandled loading state is unfinished.

---

## Next.js 16 — differences that bite

This project runs Next 16. These diverge from most training data and from Next 15 guides
(including the official Supabase SSR docs, which still show `middleware.ts`):

- **`middleware.ts` is now `proxy.ts`.** Lives at `src/proxy.ts`, exports a function named
  `proxy`. Runtime is **nodejs only** — the edge runtime is not supported there.
- **Request APIs are async-only.** `await cookies()`, `await headers()`, `await params`,
  `await searchParams`. The Next 15 synchronous shim is gone.
- **Typed route helpers**: `PageProps<'/students/[id]'>`, `LayoutProps<'/'>`,
  `RouteContext<'/api/qr/verify'>` are globally available (`npx next typegen`).
- **Turbopack is the default** for `next dev` and `next build`.
- **`revalidateTag(tag)` is deprecated** — it now takes a cache-profile second argument,
  e.g. `revalidateTag('menu', 'max')`. For read-your-writes after a mutation (the usual
  case in this app), use **`updateTag(tag)`** in a Server Action instead.

---

## Working agreements

**Test-first for `src/core/policies`.** Write the cases from architecture doc §10 before the
implementation. The domain layer is pure, so 95% coverage is cheap and guards exactly the
code where mistakes cost money. `npm run test:coverage` enforces the threshold.

**Vertical slices, not horizontal layers.** Build "the complete mess-cut feature: policy +
tests + repository + Server Action + UI," never "all the repositories."

**Migration discipline.** One migration per logical change, sequentially numbered, never
edited once applied. `scripts/check-migrations.mjs` runs pre-commit and makes editing an
applied file a hard failure. After `npm run db:push`, run `npm run db:seal`. Regenerate
types (`npm run db:types`) in the same commit as the migration.

**Review checklist for every change:**

1. Did business logic leak into a component or Server Action?
2. Does every new query filter by `tenant_id`, and does every new table have an RLS policy?

---

## Commands

| Command                 | Purpose                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `npm run dev`           | Dev server                                                   |
| `npm run verify`        | typecheck + lint + test — run before every commit            |
| `npm run test:coverage` | Unit tests with the 95% domain threshold                     |
| `npm run db:dry`        | Connect and list pending migrations without applying         |
| `npm run db:push`       | Apply migrations to the Supabase project                     |
| `npm run db:seal`       | Mark pushed migrations immutable (run right after `db:push`) |
| `npm run db:types`      | Regenerate `src/infra/supabase/database.types.ts`            |
| `npm run db:seed`       | Seed the demo tenant                                         |
| `npm run db:verify`     | Assert RLS/constraints/enums **and** that JWTs carry claims  |

## Environment

Supabase is a **hosted project only** — no local Docker stack in this setup, so migrations
apply against a live database. Credentials live in **`.env`** (gitignored) — deliberately not `.env.local`, so
migrations and app code always read the same file. See `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely and must never appear in
a client component or behind a `NEXT_PUBLIC_` prefix.

## Current scope

**MVP = Phase 0 + Phase 1** (foundations, students, plans, menu, QR attendance, headcount).
The money layer — ledger, invoices, Razorpay, mess-cut credits, grace/block — is Phase 2
and deliberately out of MVP scope. Schema is written so Phase 2 lands without rewriting
Phase 1 tables.
