-- A student cannot request the same absence twice.
--
-- The request arrives from a phone, over hostel wifi, from a student who has
-- just watched a button do nothing for two seconds. Double-taps and retries are
-- guaranteed, and each extra row is a real cost: `daysUsedInMonth` dedupes by
-- date so the cap survives, but the student's own list shows the same three
-- days twice and they cannot tell which one to cancel.
--
-- Rule 5 says idempotency is a database property, not an `if` in the action —
-- two concurrent submits both pass a SELECT-then-INSERT check.
--
-- Keyed on the whole request, including `meal_slots`: skipping lunch on the 3rd
-- and later also skipping dinner on the 3rd are genuinely different requests.
-- The array is compared as stored, and the domain sorts slots into a canonical
-- order before writing, so {LUNCH,DINNER} and {DINNER,LUNCH} cannot both exist.
--
-- Partial, on the statuses that still mean something: once a request is
-- REJECTED or CANCELLED the student is entitled to make it again.
create unique index mess_cuts_one_live_request_idx
  on public.mess_cuts (tenant_id, student_id, date_from, date_to, meal_slots)
  where status in ('PENDING', 'APPROVED', 'CREDITED');

comment on index public.mess_cuts_one_live_request_idx is
  'Idempotency for absence requests: a retried submit produces zero extra rows. Rejected and cancelled requests are excluded so a student may ask again.';

-- The student's own list, newest first. The existing
-- `mess_cuts_tenant_student_range_idx` is ordered for range containment (does a
-- cut cover this date?), which is the scan path; this one is ordered for the
-- history screen, which reads by student and sorts by date.
create index mess_cuts_student_recent_idx
  on public.mess_cuts (tenant_id, student_id, date_from desc);
