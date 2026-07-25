/**
 * What a headcount cron invocation should do.
 *
 * Shaped by two hard constraints of Vercel's Hobby plan:
 *
 *   1. **Once per day only.** A more frequent expression fails at *deploy time*
 *      with "Hobby accounts are limited to daily cron jobs", so there is no
 *      hourly refresh to lean on.
 *   2. **±59 minutes of slack.** A job set for 02:00 UTC may fire any time
 *      before 03:00, which is fine for a lock placed ~12h ahead of service.
 *
 * So each meal gets its own daily schedule, and the run works out which meal to
 * lock from the `x-vercel-cron-schedule` header Vercel sends. The docs point at
 * that header — rather than a query string — as the way to distinguish
 * schedules sharing one path.
 *
 * Query parameters still win when present, so a manual `curl` can do anything.
 */
import { ALL_MEAL_SLOTS, type MealSlot } from "@/core/domain/enums";

export interface CronPlan {
  readonly lock: boolean;
  /** Undefined means "every slot this tenant serves". */
  readonly slots?: readonly MealSlot[];
}

/**
 * Schedule → what it locks. Keep in step with `vercel.json`.
 *
 * These are UTC and tuned to the IST pilot tenant: 18:30 UTC is midnight IST
 * (12h before the 12:00 lunch), 02:00 UTC is 07:30 IST (12h before the 19:30
 * dinner). A tenant in another timezone needs its own schedules — see RUNBOOK.
 */
const SCHEDULE_LOCKS: Readonly<Record<string, MealSlot>> = {
  "30 18 * * *": "LUNCH",
  "0 2 * * *": "DINNER",
};

function parseSlots(raw: string | null): readonly MealSlot[] | undefined {
  if (!raw) return undefined;

  const valid = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is MealSlot => (ALL_MEAL_SLOTS as readonly string[]).includes(s));

  // An empty result means every name was junk. Returning `[]` would snapshot
  // nothing and report success, which is worse than ignoring the parameter.
  return valid.length > 0 ? valid : undefined;
}

export function cronPlanFor(input: {
  /** Vercel's `x-vercel-cron-schedule` header. */
  readonly schedule: string | null;
  readonly params: URLSearchParams;
}): CronPlan {
  const explicitSlots = parseSlots(input.params.get("slots"));
  const lockParam = input.params.get("lock");

  // Strictly "true": a typo like `?lock=1` must not freeze a count.
  if (lockParam !== null) {
    return {
      lock: lockParam === "true",
      ...(explicitSlots ? { slots: explicitSlots } : {}),
    };
  }

  const scheduledLock = input.schedule ? SCHEDULE_LOCKS[input.schedule.trim()] : undefined;
  if (scheduledLock) {
    return { lock: true, slots: explicitSlots ?? [scheduledLock] };
  }

  // Unrecognised schedule: refresh without locking. A schedule added to
  // vercel.json but not here must never silently freeze the wrong meal.
  return { lock: false, ...(explicitSlots ? { slots: explicitSlots } : {}) };
}
