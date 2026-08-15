# Import, export and reporting

Status: **planned, not built.** Written 2026-08-15.

## Why this exists

The mess has been running on paper for fifteen days. Several hundred students are already
enrolled, several hundred have already paid, and none of it is in the system. Typing that in
one student at a time through Admin → Students is a day of work and a guaranteed source of
transcription errors in the two fields that matter most — the roll number a student logs in
with, and the amount they paid.

So the import is not a convenience feature. It is the only realistic way this system starts
carrying real data, and it will be run **once, against a live mess, by a non-technical
person, from a spreadsheet somebody else typed.** Every design decision below follows from
that sentence.

The export and reporting sections are the other half of the same need: data that only goes
in is a trap, and an owner who cannot answer "who has not renewed?" or "how many plates
tomorrow?" will keep the paper register running alongside.

---

## 1. Import

### 1.1 One file, one row per student

Students, their plan and their subscription arrive as **one row each**. Not three files with
join keys — whoever is collecting this has a single spreadsheet with one line per student,
and asking them to normalise it into three related tables is asking for mismatched keys.

The cost of that choice is that plan details are repeated on every row. That is fine,
because **the file does not define plans**. It references them by name.

### 1.2 Plans are created first, in the UI

A plan is a catalogue item: name, duration, price, which meals it includes. If the CSV could
create one, a typo in row 4 would silently create a second plan named `Monthly Lunch` beside
`Monthly lunch` and half the students would be on a plan nobody priced.

**So: create every plan in Admin → Plans before importing.** The CSV's `plan_name` must
resolve to exactly one existing plan, and an unresolved name is a row error, never a new plan.

> **Trap already present.** The pilot tenant's only plan is `Monthly — Lunch & Dinner` — with
> an **em-dash**, and it is a 90-day plan that actually includes all four meals. Two problems:
> nobody typing in Excel will produce an em-dash, and the name describes the wrong thing.
> Matching therefore normalises case, collapses whitespace, and treats `—`, `–` and `-` as
> equivalent. The preview then shows the plan it resolved to **with its price and duration**,
> so a wrong match is visible before anything is written. Renaming that plan before the real
> import is strongly advised.

### 1.3 The column spec

`roll_number` is the key. Everything else is either required for a student to exist, or
optional.

| Column                | Req | Goes to                              | Format / rules                                                                                                                                                                                          |
| --------------------- | --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roll_number`         | ✅  | `students.roll_number`               | The login identifier and the import key. Unique per mess, case-insensitive. Trimmed.                                                                                                                    |
| `full_name`           | ✅  | `profiles.full_name`                 | As it should appear to counter staff on the scan screen.                                                                                                                                                |
| `phone`               |     | `profiles.phone`                     | 10 digits, or `+91` prefixed. For notifications later; not used to log in.                                                                                                                              |
| `email`               |     | `profiles.email`                     | A **real** address if you have one. Not the login. Left blank, the system still generates the synthetic one Supabase Auth requires.                                                                     |
| `block`               |     | `students.block`                     | Free text, e.g. `A`.                                                                                                                                                                                    |
| `room_number`         |     | `students.room_number`               | Free text, e.g. `101`.                                                                                                                                                                                  |
| `joined_at`           |     | `students.joined_at`                 | `YYYY-MM-DD`. Defaults to the import date. Set it for a true joining date.                                                                                                                              |
| `status`              |     | `students.status`                    | `ACTIVE` \| `GRACE` \| `BLOCKED` \| `INACTIVE`. Default `ACTIVE`.                                                                                                                                       |
| `plan_name`           |     | resolves to `plans.id`               | Must match an existing plan. **Blank = student is created with no plan** and cannot eat until one is assigned.                                                                                          |
| `plan_start_date`     | ⚠️  | `subscriptions.start_date`           | `YYYY-MM-DD`. **Required whenever `plan_name` is given.** Backdate it — for this first import that is when the mess actually started serving them.                                                      |
| `plan_end_date`       |     | `subscriptions.end_date`             | `YYYY-MM-DD`. Blank = start date + the plan's `duration_days` − 1 (the period is inclusive).                                                                                                            |
| `amount_paid_inr`     |     | `subscriptions.price_paise_snapshot` | **Rupees**, e.g. `5200` or `5200.50`. Blank = the plan's list price. Set it for a discount, a staff rate, or a part payment. Converted to paise at the boundary; more than two decimals is a row error. |
| `payment_reference`   |     | audit / Phase 2 ledger               | Your receipt or UTR number. Stored so a "he says he paid" dispute is answerable.                                                                                                                        |
| `subscription_status` |     | `subscriptions.status`               | `ACTIVE` \| `PENDING_PAYMENT`. Default `ACTIVE` when `amount_paid_inr` is present, else `PENDING_PAYMENT`.                                                                                              |

**Header row is mandatory. Column order does not matter — they are matched by name.** Extra
columns are ignored, so you may keep your own notes in the sheet.

### 1.4 Three phases, because a half-finished import is worse than none

**Upload → Preview → Commit.** Nothing is written during the first two.

1. **Upload.** The file is parsed and every row validated against the rules above and against
   the database (does the plan exist? is this roll number already taken?).
2. **Preview.** A table showing, per row: what will be created, what will be _updated_, and
   every error with its row number and column. Plus totals — "212 new students, 6 updates,
   4 errors, ₹11,02,400 in subscriptions". **The commit button is disabled while any row has
   an error.** A 300-row file that half-applies and fails on row 147 is a reconciliation job
   nobody has time for.
3. **Commit,** in batches of about 25 rows, each batch its own request.

   Batching is not optional. Every student needs a Supabase Auth user, which is one API call
   each — 300 of them is well past any serverless function timeout, and Vercel Hobby is
   especially tight. Batching keeps each request short, shows real progress, and means a
   dropped connection loses one batch rather than the whole import.

### 1.5 Re-running the same file must be safe

It **will** be re-run — someone will fix four rows and upload the corrected sheet.

Keyed on `(tenant_id, lower(roll_number))`, which is already a unique index. A row whose roll
number exists is an **update** of the profile and room fields, never a second student.

Subscriptions are the dangerous half. `subscriptions_one_active_per_student` permits only one
`ACTIVE` row per student, so a re-import must not attempt a second. The rule:

- student has no subscription → create it
- student already has one covering the same period → **skip, silently and visibly** (counted
  as "unchanged" in the preview)
- student has a _different_ active subscription → **error, not an overwrite.** Changing what
  somebody paid for is a decision, and it happens on the student's own page with an audit
  entry — not as a side effect of re-uploading a spreadsheet.

### 1.6 Passwords

Each new student gets a generated temporary password and `must_change_password = true`.

Three hundred passwords have to reach three hundred students. At the end of a commit the
admin is offered a **one-time CSV download** of `roll_number, full_name, temporary_password`.
It is generated from the response in the browser and never stored — there is no screen that
shows it again, and re-issuing means a password reset on the student's page.

That file is the most sensitive artefact this system produces. The download screen says so.

### 1.7 What the import must never do

- **Never** read `tenant_id` from the file. It comes from the session, always.
- **Never** create or modify a plan.
- **Never** overwrite an existing subscription.
- **Never** import a student into another mess — cross-tenant roll numbers are a known
  collision (`CS21B001` exists in two seeded tenants) and the key is scoped per tenant.
- **Never** write anything if any row failed validation.

Every commit writes one `audit_log` entry naming the file, the row count, and the actor.

---

## 2. Export

Everything the mess can see, it can take with it. Plain CSV, opens in Excel, no formatting.

| Export            | Contents                                                         | Why                                                                 |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Students**      | Every column the import accepts, plus current plan state         | Round-trips: export, edit in Excel, re-import                       |
| **Attendance**    | Date range; roll number, name, date, meal, method, reversed      | Disputes, and the monthly reconciliation against the paper register |
| **Absences**      | Date range; roll number, kind, dates, meals, status, who decided | Verifying credits when Phase 2 bills                                |
| **Headcount**     | Date range; date, meal, projected, actual served, variance       | The kitchen's own record of over- and under-cooking                 |
| **Subscriptions** | Every subscription with dates, price, status                     | What is owed and by whom                                            |

Rules that apply to all of them: admin-only; tenant-scoped in the query, not just the UI;
**audit-logged**, because exporting the roster is a data-protection event; dates rendered in
the tenant's timezone; money in rupees with two decimals at the render boundary only.

The students export is deliberately import-compatible. That round trip — export, bulk-edit
rooms in Excel, re-import — is how an admin will actually do the start-of-term reshuffle.

---

## 3. Reporting

The dashboard answers "what is happening now". Reporting answers "what happened, and what is
about to". Five reports, each tied to a decision somebody actually makes:

1. **Renewals due.** Students whose plan lapses in the next N days, plus everyone already
   lapsed. _Immediately useful: seven of the eight students on the pilot tenant are lapsed
   right now and cannot be served._ This is the single highest-value report and should be
   built first — it is a worklist, with a renew action on each row.

2. **Attendance summary.** Per student over a period: meals eaten, meals possible, percentage.
   Surfaces the student who has not eaten in three weeks (left the hostel, still on the
   roster, still being cooked for) and the one eating every meal (fine — but the mess should
   know its real cost per head).

3. **Meal-wise trends.** Served counts per meal slot over time. Answers "is breakfast worth
   cooking?" with a number instead of an argument. A mess serving 40 breakfasts and 300
   dinners has a decision to make.

4. **Waste and shortfall.** Projected headcount vs actually served, per meal, over time. The
   projection is this product's main claim; this report is the evidence it works, and the
   feedback loop that improves it.

5. **Absence patterns.** Cuts and away days by date. Shows the exam-week cliff before it
   happens, which is the whole reason the monthly cap exists.

Each renders as a real table with the four designed states, has a date-range control, and
exports to CSV from the same screen. Money and dates formatted, never raw.

Phase 2 adds collections, outstanding dues and per-student ledgers; the schema already
carries `price_paise_snapshot` and `payment_reference` so those reports need no backfill.

---

## 4. Build order

1. **Renewals-due report** — smallest, and immediately useful on live data today.
2. **Students export** — proves the CSV writer, and gives a real template for the import.
3. **Student import** — upload, validate, preview, batched commit, password download.
4. **Subscriptions in the import** — the plan/price/date columns.
5. **Remaining exports** — attendance, absences, headcount, subscriptions.
6. **Remaining reports** — attendance summary, meal trends, waste, absence patterns.

Ordering 2 before 3 is deliberate: the export defines the exact column names and formats the
import must accept, so the two cannot drift apart, and the admin gets a file to start from.

Every step follows the working agreements — the parsing, validation, plan-matching and
idempotency rules are **pure policy in `src/core/policies`, tested before implementation.**
CSV parsing must be hand-rolled or use what is already installed; no new dependency.

---

## 5. Decisions needed before building

- **Rename the existing plan.** `Monthly — Lunch & Dinner` is 90 days and includes all four
  meals. What should it be called, and is 90 days right for a plan labelled "Monthly"?
- **Should plans get a short `code`** (`M-ALL`, `Q-LD`) for the CSV to reference instead of a
  name with punctuation in it? Cheap now, a migration later.
- **Part payments.** If `amount_paid_inr` is less than the plan price, is that `ACTIVE` or
  `PENDING_PAYMENT`? The proposal above assumes any amount means `ACTIVE`; the alternative is
  a `PARTIAL` state, which is really a Phase 2 ledger question.
- **Do you have real email addresses** for students? It changes whether notifications are
  worth building.
