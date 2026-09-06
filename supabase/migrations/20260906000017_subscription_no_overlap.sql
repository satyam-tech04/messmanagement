-- ============================================================================
-- 017 — A student may not hold two subscriptions covering the same day
--
-- Replaces `subscriptions_one_active_per_student`, a partial unique index that
-- allowed exactly one row with status = 'ACTIVE' per student.
--
-- ## Why that index was the wrong rule
--
-- It was a proxy for the real constraint, and the proxy blocked something
-- legitimate. "Scheduled" is DERIVED from the dates here, not stored -- nothing
-- writes to the status column when time passes -- so a subscription starting
-- next month sits at 'ACTIVE' today. Under the old index that made the
-- commonest renewal impossible: a student paying on the 25th for a term
-- starting the 1st needs two subscriptions to exist at once.
--
-- The rule the business actually has is that no two subscriptions may cover the
-- same DAY. Two plans over one day would count the student twice in every
-- headcount and make "which plan paid for this meal?" unanswerable. Terms that
-- merely follow one another are fine -- that is what a renewal IS.
--
-- ## What releases a date range
--
-- CANCELLED and EXPIRED are excluded from the constraint. Cancelling frees the
-- dates, exactly as it does for subscription_pauses in migration 013, and an
-- explicit EXPIRED is the deliberate escape hatch for an admin who must
-- overlap to correct a mistake. A plan that has merely run out is NOT released:
-- its column still reads 'ACTIVE', so its days stay claimed and nobody can
-- backdate a second plan over a period that was already served and paid for.
--
-- ## Safe against live data
--
-- Checked before writing this: 36 ACTIVE, 2 CANCELLED, 1 EXPIRED across the
-- project; no student holds more than one non-cancelled subscription, and there
-- are zero overlapping ranges. The constraint applies without touching a row.
--
-- `btree_gist` is already installed by migration 013.
-- ============================================================================

alter table public.subscriptions
  add constraint subscriptions_no_overlap
  exclude using gist (
    student_id with =,
    -- Inclusive at both ends, matching how a subscription is read everywhere
    -- else: a 30-day plan from the 1st runs through the 30th.
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('ACTIVE', 'PENDING_PAYMENT'));

-- Dropped only after the replacement is in place, so there is no window in
-- which a student could acquire two overlapping plans.
drop index if exists public.subscriptions_one_active_per_student;

comment on constraint subscriptions_no_overlap on public.subscriptions is
  'No two subscriptions may cover the same day for one student. Consecutive terms are legal -- that is what a renewal is. CANCELLED and EXPIRED rows release their dates. Mirrored by overlappingPeriod() in plan.policy.ts.';
