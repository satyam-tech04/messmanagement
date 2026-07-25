/**
 * Database row → domain object mapping, with boundary validation (rule 10).
 *
 * Lives in infra because it knows the persistence shape. Core defines the
 * target types and remains unaware that Postgres exists.
 */
import { z } from "zod";
import { ALL_MEAL_SLOTS } from "@/core/domain/enums";
import type { MealSlotConfig, TenantSettings } from "@/core/domain/tenant-context";
import { toWallClockTime } from "@/core/time";
import type { Database } from "./database.types";

const wallClock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM, 24-hour");

/**
 * `tenant_settings.meal_slots` is `jsonb`; Postgres guarantees only that it is
 * an array. The shape inside drives the meal window every QR scan is checked
 * against, so a malformed entry would either reject every scan of that meal or
 * silently widen the window. Parse it.
 */
export const mealSlotsSchema = z
  .array(
    z.object({
      slot: z.enum(ALL_MEAL_SLOTS as unknown as [string, ...string[]]),
      start: wallClock,
      end: wallClock,
    }),
  )
  .min(1, "A tenant must serve at least one meal slot")
  .superRefine((slots, ctx) => {
    const seen = new Set<string>();
    for (const s of slots) {
      if (seen.has(s.slot)) {
        // Two windows for one slot makes "is the counter open?" ambiguous, and
        // whichever the code found first would win silently.
        ctx.addIssue({ code: "custom", message: `Duplicate meal slot: ${s.slot}` });
      }
      seen.add(s.slot);
    }
  });

type SettingsRow = Database["public"]["Tables"]["tenant_settings"]["Row"];

export function toTenantSettings(row: SettingsRow): TenantSettings {
  const parsed = mealSlotsSchema.safeParse(row.meal_slots);
  if (!parsed.success) {
    // Fail loudly. A tenant whose meal windows cannot be parsed must break at
    // startup, not silently turn away every student at lunch.
    throw new Error(
      `tenant_settings.meal_slots is malformed for tenant ${row.tenant_id}: ` +
        parsed.error.issues.map((i) => i.message).join("; "),
    );
  }

  const mealSlots: MealSlotConfig[] = parsed.data.map((s) => ({
    slot: s.slot as MealSlotConfig["slot"],
    start: toWallClockTime(s.start),
    end: toWallClockTime(s.end),
  }));

  return {
    tenantId: row.tenant_id,
    mealSlots,
    cutAdvanceHours: row.cut_advance_hours,
    cutMaxDaysPerMonth: row.cut_max_days_per_month,
    gracePeriodDays: row.grace_period_days,
    blockOnOverdue: row.block_on_overdue,
    allowExtras: row.allow_extras,
    guestTokenPricePaise: row.guest_token_price_paise,
    extraPlatePricePaise: row.extra_plate_price_paise,
    qrTokenTtlSeconds: row.qr_token_ttl_seconds,
    qrRefreshSeconds: row.qr_refresh_seconds,
    currency: row.currency,
  };
}

/**
 * Normalises a PostgREST embedded relation to a single row or null.
 *
 * PostgREST decides the shape from the schema, not from the query: an embed is
 * an **object** when the relationship is to-one (the foreign key is unique or
 * the join follows the FK forwards) and an **array** when it is to-many. That
 * distinction is invisible in the select string, so it is easy to guess wrong —
 * and a wrong guess is silent, because indexing an object returns `undefined`
 * rather than throwing.
 *
 * That exact mistake shipped: `profiles → students` is a reverse embed whose FK
 * is unique, so it collapsed to an object, `students[0]` was `undefined`, and
 * every student session ended up with no `studentId`.
 *
 * Handling both shapes also means a migration that adds or drops a UNIQUE
 * constraint cannot silently break an unrelated screen.
 */
export function firstRelated<T>(relation: T | T[] | null | undefined): T | null {
  if (relation == null) return null;
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation;
}
