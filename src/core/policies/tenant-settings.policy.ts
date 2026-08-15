/**
 * Tenant settings validation.
 *
 * Meal windows are the highest-stakes setting here: they decide when a scan is
 * accepted. Two overlapping windows would let a student be served twice — once
 * under each slot — and both scans would look entirely legitimate, because the
 * uniqueness constraint is per `(student, date, meal_slot)`.
 *
 * The database has CHECK constraints for the numeric ranges; this validates the
 * same rules first so an admin gets a readable sentence instead of a raw
 * constraint violation, and catches the overlap rule, which SQL cannot express.
 */
import { ALL_MEAL_SLOTS, type MealSlot, type UserRole } from "@/core/domain/enums";
import { domainError, forbidden, type DomainError } from "@/core/errors";
import { err, ok, type Result } from "@/core/result";
import { isWallClockTime, toWallClockTime, type WallClockTime } from "@/core/time";

/** Mirrors `tenant_settings_qr_ttl_sane`. */
const MIN_TTL_SECONDS = 10;
const MAX_TTL_SECONDS = 300;

export interface MealSlotInput {
  readonly slot: MealSlot;
  readonly start: string;
  readonly end: string;
}

export interface TenantSettingsInput {
  readonly actorRole: UserRole;
  readonly mealSlots: readonly MealSlotInput[];
  readonly qrTokenTtlSeconds: number;
  readonly qrRefreshSeconds: number;
  /**
   * Slots that **active plans** still offer.
   *
   * Deliberately not derived from subscription snapshots. A snapshot is frozen
   * history — what a student already agreed to — and can never be edited, so
   * including it would make any settings change permanently impossible once a
   * single old subscription mentioned a meal. Active plans are editable, which
   * gives the admin a way out: retire or edit the plan, then change the times.
   */
  readonly slotsInUse: readonly MealSlot[];
}

export interface TenantSettingsDraft {
  readonly mealSlots: readonly {
    readonly slot: MealSlot;
    readonly start: WallClockTime;
    readonly end: WallClockTime;
  }[];
  readonly qrTokenTtlSeconds: number;
  readonly qrRefreshSeconds: number;
}

/** Minutes since midnight, for interval comparison. */
function minutesOf(time: WallClockTime): number {
  const [h, m] = time.split(":").map(Number);
  return h! * 60 + m!;
}

/**
 * A window as a half-open interval, unrolled across midnight where needed.
 *
 * A dinner running 22:00–00:30 becomes 1320→1470 so it can be compared with
 * same-day windows without special cases at every call site.
 */
function intervalOf(start: WallClockTime, end: WallClockTime): [number, number] {
  const from = minutesOf(start);
  const to = minutesOf(end);
  return to > from ? [from, to] : [from, to + 24 * 60];
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  // Start-inclusive, end-exclusive, so windows that merely touch — lunch ending
  // at 14:30 and dinner starting at 14:30 — are adjacent, not overlapping.
  return a[0] < b[1] && b[0] < a[1];
}

export function parseTenantSettings(
  input: TenantSettingsInput,
): Result<TenantSettingsDraft, DomainError> {
  if (input.actorRole !== "ADMIN" && input.actorRole !== "SUPER_ADMIN") {
    return err(forbidden("Only an admin can change mess settings."));
  }

  if (input.mealSlots.length === 0) {
    return err(domainError("VALIDATION_FAILED", "A mess must serve at least one meal."));
  }

  const parsed: { slot: MealSlot; start: WallClockTime; end: WallClockTime }[] = [];

  for (const entry of input.mealSlots) {
    if (!isWallClockTime(entry.start) || !isWallClockTime(entry.end)) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Enter ${entry.slot.toLowerCase()} times as HH:MM, 24-hour.`,
          { slot: entry.slot },
        ),
      );
    }

    const start = toWallClockTime(entry.start);
    const end = toWallClockTime(entry.end);

    if (minutesOf(start) === minutesOf(end)) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `The ${entry.slot.toLowerCase()} window starts and ends at the same time.`,
          { slot: entry.slot },
        ),
      );
    }

    if (parsed.some((p) => p.slot === entry.slot)) {
      return err(
        domainError("CONFLICT", `${entry.slot} is configured twice.`, { slot: entry.slot }),
      );
    }

    parsed.push({ slot: entry.slot, start, end });
  }

  // Overlap is the rule the database cannot express, and the one that lets a
  // student eat twice.
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i]!;
      const b = parsed[j]!;
      if (overlaps(intervalOf(a.start, a.end), intervalOf(b.start, b.end))) {
        return err(
          domainError(
            "CONFLICT",
            `${a.slot.toLowerCase()} and ${b.slot.toLowerCase()} overlap. A student could be served twice.`,
          ),
        );
      }
    }
  }

  // Removing a meal is not symmetrical with adding one: nothing can depend on a
  // slot that did not exist, but plenty depends on one that did.
  const configured = new Set(parsed.map((p) => p.slot));
  const dropped = input.slotsInUse.filter((slot) => !configured.has(slot));
  if (dropped.length > 0) {
    const names = dropped.map((s) => s.toLowerCase()).join(" and ");
    return err(
      domainError(
        "CONFLICT",
        `An active plan still offers ${names}. Edit or retire that plan first, then stop serving ${dropped.length > 1 ? "those meals" : "it"}.`,
        { slots: dropped.join(",") },
      ),
    );
  }

  if (
    !Number.isInteger(input.qrTokenTtlSeconds) ||
    input.qrTokenTtlSeconds < MIN_TTL_SECONDS ||
    input.qrTokenTtlSeconds > MAX_TTL_SECONDS
  ) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `The QR code must stay valid for between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS} seconds.`,
      ),
    );
  }

  if (!Number.isInteger(input.qrRefreshSeconds) || input.qrRefreshSeconds < 1) {
    return err(domainError("VALIDATION_FAILED", "The refresh interval must be at least a second."));
  }

  if (input.qrRefreshSeconds >= input.qrTokenTtlSeconds) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "The code must refresh before it expires, or students will be holding a dead code between redraws.",
      ),
    );
  }

  // Sorted by time of day so the settings screen, the menu planner and the
  // student's "next meal" all agree on the order.
  const mealSlots = [...parsed].sort(
    (a, b) => ALL_MEAL_SLOTS.indexOf(a.slot) - ALL_MEAL_SLOTS.indexOf(b.slot),
  );

  return ok({
    mealSlots,
    qrTokenTtlSeconds: input.qrTokenTtlSeconds,
    qrRefreshSeconds: input.qrRefreshSeconds,
  });
}
