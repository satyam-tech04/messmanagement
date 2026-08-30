# Meal Planner, Feedback & Special Meals — Implementation Specification

> **Instructions for the coding model:** This document is the single source of truth for
> these three features. Implement exactly what is described here. Do not invent features,
> fields, screens, or business rules beyond what is written. Where a decision was ambiguous
> in the original request, Section 0 states the **resolved assumption** to build against —
> follow it unless the user explicitly overrides it. If you encounter a situation not
> covered by this document, stop and ask rather than guessing.

These are items 4, 5 and 6 of the handwritten requirements of 2026-08-30. The three
earlier documents in this folder ([billing](./meal-billing-feature-spec.md),
[pricing](./meal-pricing-feature-spec.md),
[grace period](./student_subscription_grace_period_feature.md)) do not cover them — a
search of all three for "planner", "feedback", "rating", "special" and "announce" returns
nothing relevant. This document fills that gap and follows their structure: each feature
has its own numbered section, its own data model, its own validation rules and its own
acceptance criteria.

---

## 0. Resolved Assumptions (read first)

### 0.1 The governing constraint — the student app is read-only

Stated by the project owner on 2026-08-30:

> "Nothing is student facing. Student only should be able to show QR and view only details
> and notifications."

This is the strongest constraint in this document and it outranks anything below it.

| A student may                                     | A student may **not**                     |
| ------------------------------------------------- | ----------------------------------------- |
| Show their meal QR code                           | Enter, submit, choose or request anything |
| View their own plan, dates and status             | Opt in or out of a meal                   |
| View the menu                                     | Book, reserve or pre-order                |
| View notifications and special-meal announcements | Rate, comment or reply                    |

Everything else in the product is **operated by an admin or staff member**, on a mess
device, and the student's screen only ever reflects it.

> ⚠️ **This constraint contradicts Feature 2 (Feedback) as written on the note.** Feedback
> is inherently something a student _submits_. §5.1 states the resolved assumption and the
> alternative; that is the one decision in this document that still needs the owner's word
> before implementation begins.

### 0.2 Table of resolved assumptions

| #   | Topic                            | Resolved Assumption                                                                                                                                                                                               |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Special meals are display-only   | A special meal is an **announcement**, not an entitlement. Nothing is tracked, counted, charged or claimed. Students read it and come to the mess; everything after that happens offline.                         |
| B2  | No headcount impact              | A special meal must **not** alter the headcount projection, attendance, eligibility or the QR flow. It touches no existing operational path.                                                                      |
| B3  | No money                         | Special meals carry no price, no add-on charge and no ledger entry. If a mess charges for one, it is rung up through **Counter sales** (NF-3), which already exists and is unconnected to this feature.           |
| B4  | Notifications are pull, not push | "Notification" here means an item rendered on the student's own screen when they open the app. No email, no SMS, no push, no new infrastructure — matching the grace-period spec §26, which forbids exactly that. |
| B5  | Meal planner is staff-side       | Per §0.1 the planner is never student-facing. It plans what the kitchen will serve; students only view the result.                                                                                                |
| B6  | Notification authorship          | Only an **Administrator** creates, edits or removes announcements. Staff and students never do.                                                                                                                   |
| B7  | Announcement scope               | An announcement belongs to one mess and is visible to every student in it. There is no per-student or per-plan targeting in v1.                                                                                   |
| B8  | Retention                        | Announcements are not deleted when they expire — they stop showing and remain in the admin list, so a mess can see what it announced last month.                                                                  |

---

## 1. Feature Overview

Three independent features, deliberately kept apart:

1. **Meal Planner** — extends the existing admin week planner so the kitchen can plan
   further ahead and reuse what it already planned.
2. **Feedback** — collecting what students think of the food. Blocked on §5.1.
3. **Special Meal Announcements** — an admin posts "Onam Sadhya this Sunday"; students see
   it; nothing else happens.

Features 1 and 3 both touch the menu, and must not be merged. A planned menu is _what the
kitchen will cook every day_; a special meal is _an announcement about an unusual day_. A
mess that puts "Onam Sadhya" in Sunday's menu has told the kitchen; it has not told the
students in a way they will notice.

---

# FEATURE 1 — MEAL PLANNER

## 2. What already exists

**Do not rebuild this.** `/admin/menu` already provides:

- A week-at-a-time grid, one column per day and one row per meal slot.
- Free-text items, one per line, stored as a JSON array on `menus.items`.
- A uniqueness guarantee of one menu per `(tenant, service_date, meal_slot)`.
- A student-facing read-only view of today's menu.
- Publish and clear actions, both audited.

Migration 002 defines the `menus` table. Any work below is **additive to it**.

## 3. Data Model

No new table. Additive columns on `public.menus` only if a feature below requires one.

| Field          | Type        | Notes                                                   |
| -------------- | ----------- | ------------------------------------------------------- |
| `id`           | uuid        | exists                                                  |
| `tenant_id`    | uuid        | exists                                                  |
| `service_date` | date        | exists — tenant-local, never derived from a UTC instant |
| `meal_slot`    | enum        | exists                                                  |
| `items`        | jsonb array | exists                                                  |
| `notes`        | text        | exists                                                  |
| `published_by` | uuid        | exists                                                  |

## 4. Required Behaviour

The planner must gain the following, and nothing else:

### 4.1 Plan further ahead than one week

- The grid must accept a date range beyond the current week — at minimum, the ability to
  move forward and back by week without limit.
- Past weeks are viewable but **read-only**: a menu for a day already served is a record of
  what was cooked, and editing it would rewrite history the kitchen acted on.

### 4.2 Copy a week

- An admin may copy an entire week's menus onto another week.
- Copying must **never overwrite** a day that already has a menu unless the admin
  explicitly confirms that specific overwrite.
- Copying is a menu operation only: it does not copy special-meal announcements (§10).

### 4.3 See what is missing

- Any day/slot with no menu must be visually distinct from one deliberately left empty.
- The planner must show, for the visible range, how many slots are still unplanned.

### 4.4 Out of scope for Feature 1

Ingredients, quantities, recipes, costing, stock, procurement, supplier orders, nutritional
information, and per-student meal selection. None of these have a data model and none were
requested.

## 5. Acceptance Criteria — Meal Planner

- [ ] An admin can move to any future week and plan it.
- [ ] A past week renders but cannot be edited.
- [ ] Copying a week onto an empty week fills every slot.
- [ ] Copying onto a week that already has menus does not silently overwrite them.
- [ ] Unplanned slots are visually distinct from empty ones, with a count for the range.
- [ ] The student's menu view is unchanged except that it shows whatever was planned.

---

# FEATURE 2 — FEEDBACK

## 5.1 ⚠️ Blocked — one decision required

The handwritten note says "Feedback option". §0.1 says students may not submit anything.
Those cannot both hold, because feedback is by definition submitted by the person eating.

**Resolved assumption to build against if no other instruction is given: do not build
Feature 2.** It is deferred, not designed, because every possible implementation violates
either the note or the constraint.

The owner must pick one before any work starts:

| Option                           | What it means                                                                                                                      | Cost                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **A — Defer** (assumed)          | Nothing is built. Feedback continues to be given verbally at the counter.                                                          | none                                                        |
| **B — Student submits a rating** | A student rates a meal from their own screen. **Requires relaxing §0.1** to allow exactly one student input.                       | Small: one table, one screen, one admin report              |
| **C — Staff record it**          | Staff enter feedback they were told at the counter, attributed to a meal and date, never to a named student. Honours §0.1 exactly. | Small, but captures far less and depends on staff bothering |

**Do not implement B or C on your own judgement.** If the answer is A, delete this section
rather than leaving a designed-but-unbuilt feature in the tracker.

---

# FEATURE 3 — SPECIAL MEAL ANNOUNCEMENTS

## 6. Feature Overview

The mess owner announces something unusual — a festival meal, a special Sunday lunch — and
every student in that mess sees it on their own screen. That is the entire feature.

Direct from the project owner, 2026-08-30:

> "Special meal — it's only for display, as a notification for students. Nothing to be
> tracked here. Mess owner will add special meal options and students will be able to see,
> that's it. Then they will come to mess and do everything offline. It's a very simple
> notification thing."

Read that as a hard boundary. Every temptation below is out of scope:

- ❌ Students opting in or registering interest
- ❌ Counting how many will attend
- ❌ Charging for it
- ❌ Affecting eligibility, attendance, the QR code or the headcount
- ❌ Reminders, push notifications, email or SMS

## 7. Data Model

New table: `public.announcements`

| Field                       | Type                           | Notes                                                                                         |
| --------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| `id`                        | uuid PK                        |                                                                                               |
| `tenant_id`                 | uuid                           | required on every row, index and query                                                        |
| `title`                     | text                           | required, short — e.g. "Onam Sadhya"                                                          |
| `body`                      | text                           | optional — the detail, e.g. the dishes                                                        |
| `service_date`              | date, nullable                 | the day it is about, in the mess's timezone. Null for an announcement with no particular day. |
| `meal_slot`                 | enum, nullable                 | which meal, when it applies to one                                                            |
| `starts_on`                 | date                           | first day it appears on student screens                                                       |
| `ends_on`                   | date                           | last day it appears. Inclusive.                                                               |
| `status`                    | enum `Published` \| `Archived` | see §9                                                                                        |
| `created_by`                | uuid                           | the admin who posted it                                                                       |
| `created_at` / `updated_at` | timestamptz                    |                                                                                               |

**Money:** none. This table has no price column and must never gain one (B3).

**Multi-tenancy:** `tenant_id` on the table, on every index and in every query, with RLS
policies — admins write, students and staff read their own mess only. `tenant_id` is
derived server-side and never accepted from the client.

**Dates:** `service_date`, `starts_on` and `ends_on` are plain dates computed in the
tenant's timezone through `src/core/time`. Never `toISOString().slice(0, 10)`.

## 8. Administrator Workflow

1. Admin opens **Announcements** in the admin navigation.
2. Admin enters a title, optionally a body, optionally the date and meal it concerns, and
   the window during which it should show.
3. On save it is immediately visible to every student in that mess whose current date falls
   within the window.
4. Admin can edit or archive it at any time.

Validation:

- [ ] `title` required, 1–120 characters after trimming.
- [ ] `body` optional, at most 2,000 characters.
- [ ] `ends_on` must not be before `starts_on`.
- [ ] `starts_on` may be in the past (a mess posting today about today is the normal case).
- [ ] Only an Administrator may create, edit or archive. Staff and students may not (B6).

## 9. Status

| Status        | Meaning               | Student sees it?                                  |
| ------------- | --------------------- | ------------------------------------------------- |
| **Published** | Live                  | Only while today is within `[starts_on, ends_on]` |
| **Archived**  | Withdrawn by an admin | Never                                             |

Visibility is **derived from the dates**, not stored. Nothing in this system runs on a
schedule to flip a column when a date arrives — the same reason
`subscription-state.ts` and `pause.policy.ts` derive their states — so an announcement must
appear and disappear on its own, with no job.

## 10. Student Display

On the student's own screen, above or beside the existing plan and menu cards:

```text
Special meal

Onam Sadhya — Sunday 14 September
Lunch

Payasam, avial, thoran, sambar, rice, papad.
```

Rules:

- Read-only. No buttons, no acknowledgement, no dismissal that has to be stored (B4, §0.1).
- Shown only when at least one announcement is live for that student's mess today.
- Absent entirely when there is none — no empty "No announcements" card taking up space on
  the one screen a student uses at a counter.
- Must not displace or interfere with the QR code, which is the reason the screen exists.

## 11. What this feature must not touch

Stated explicitly because each is a plausible mistake:

- `attendance`, `mess_cuts`, `headcount_snapshots` — an announcement changes no count (B2).
- `subscriptions`, `plans`, `meal_prices` — it is not an entitlement and has no price (B3).
- The QR issuance and verification path — an announcement can never make a student more or
  less eligible for a meal.
- `menus` — a special meal announcement is separate from the planned menu (§1). An admin
  may well enter both; the system does not link them in v1.

## 12. Acceptance Criteria — Special Meals

- [ ] An admin can post an announcement with a title, body, date, meal and date window.
- [ ] Every student in that mess sees it while today falls inside the window.
- [ ] A student in a **different** mess never sees it.
- [ ] It disappears on its own the day after `ends_on`, with no job running.
- [ ] An archived announcement is immediately invisible to students and still visible to the admin.
- [ ] A student has no control on the announcement at all — nothing to tap, submit or dismiss.
- [ ] Posting, editing and archiving an announcement changes no headcount, attendance,
      eligibility, plan or price anywhere in the system.
- [ ] Staff and students cannot create, edit or archive one, including by direct API call.

---

## 13. Out of Scope (all three features)

Push notifications, email, SMS, and any new messaging infrastructure. Student-submitted
anything (subject to §5.1). Per-student or per-plan targeting of announcements. Attendance
or headcount effects. Pricing or charging of any kind. Ingredients, stock, procurement or
costing. Recurring or auto-repeating announcements. Read receipts, or any record of which
student saw what.
