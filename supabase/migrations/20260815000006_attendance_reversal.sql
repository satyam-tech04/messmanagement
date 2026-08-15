-- Attendance corrections.
--
-- Staff serve the wrong student — a mistyped roll number, the wrong person
-- waved through — and until now there was no way to undo it. The row was
-- permanent, the headcount was wrong, and in Phase 2 that student would be
-- billed for a meal they never ate.
--
-- Attendance stays append-only (rule 4): nothing is deleted. A correction marks
-- the row reversed and records who did it and why, so the original scan and its
-- reversal are both permanently visible.
--
-- The uniqueness guarantee has to move with it. `UNIQUE (tenant_id, student_id,
-- service_date, meal_slot)` is what makes a scan idempotent, but as a plain
-- constraint it would also keep blocking the student after a reversal — and a
-- student whose meal was reversed because it was recorded in error has *not*
-- eaten, so they must be able to be served. Replacing it with a partial unique
-- index over live rows only preserves the anti-replay guarantee exactly, while
-- letting a corrected mistake be re-recorded.

alter table public.attendance
  add column reversed_at     timestamptz,
  add column reversed_by     uuid references public.profiles (id) on delete set null,
  add column reversal_reason text;

-- A reversal must say who and why, or it is indistinguishable from corruption.
alter table public.attendance
  add constraint attendance_reversal_is_explained check (
    (reversed_at is null and reversed_by is null and reversal_reason is null)
    or (reversed_at is not null and reversal_reason is not null
        and length(btrim(reversal_reason)) > 0)
  );

alter table public.attendance
  drop constraint attendance_tenant_student_date_slot_key;

-- Same guarantee, scoped to rows that still count.
create unique index attendance_one_live_per_student_meal
  on public.attendance (tenant_id, student_id, service_date, meal_slot)
  where reversed_at is null;

-- Reversed rows are read constantly by the admin review screen and never by the
-- counter, so keep them out of the hot index above and give them their own.
create index attendance_reversed_idx
  on public.attendance (tenant_id, service_date)
  where reversed_at is not null;

comment on column public.attendance.reversed_at is
  'Set when an admin corrects a mistaken scan. The row is never deleted; a '
  'reversed row stops counting toward the headcount and stops blocking a new '
  'scan for the same meal.';
