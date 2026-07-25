/**
 * Menu policy (§8).
 *
 * Two decisions:
 *
 *   1. What makes a published menu valid.
 *   2. Given "now", which meal is being served and which comes next — the
 *      question the student's home screen and the staff scanner both ask.
 *
 * The second is where the tenant's timezone matters most. A student opening the
 * app at 01:30 IST has already crossed into a new day; deriving the service date
 * from UTC would show them the previous day's dinner.
 */
import { ALL_MEAL_SLOTS, type MealSlot, type UserRole } from "@/core/domain/enums";
import type { MealSlotConfig } from "@/core/domain/tenant-context";
import { domainError, forbidden, type DomainError } from "@/core/errors";
import { err, ok, type Result } from "@/core/result";
import {
  addDays,
  compareServiceDates,
  differenceInDays,
  isWithinWindow,
  mealWindowOn,
  serviceDateOf,
  type ServiceDate,
} from "@/core/time";

/** A menu may be recorded a day late, but no later — beyond that it is a typo. */
const MAX_DAYS_IN_PAST = 1;
/** Roughly a season of forward planning; anything more is a mistyped year. */
const MAX_DAYS_AHEAD = 180;
const MAX_ITEMS = 50;
const MAX_ITEM_LENGTH = 200;
const MAX_NOTES_LENGTH = 500;

function isAdmin(role: UserRole): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

// --- Publishing -----------------------------------------------------------

export interface MenuDraftInput {
  readonly actorRole: UserRole;
  readonly serviceDate: ServiceDate;
  readonly mealSlot: MealSlot;
  readonly items: readonly string[];
  readonly notes: string;
  /** The slots this tenant actually serves, from tenant settings. */
  readonly servedSlots: readonly MealSlot[];
  /** The tenant's current date, derived by the caller via `serviceDateOf`. */
  readonly today: ServiceDate;
}

export interface MenuDraft {
  readonly serviceDate: ServiceDate;
  readonly mealSlot: MealSlot;
  readonly items: readonly string[];
  readonly notes: string | null;
}

export function parseMenuDraft(input: MenuDraftInput): Result<MenuDraft, DomainError> {
  if (!isAdmin(input.actorRole)) {
    return err(forbidden("Only an admin can publish the menu."));
  }

  // A slot the tenant does not serve has no meal window, so the menu would be
  // published and then never shown to anyone.
  if (!input.servedSlots.includes(input.mealSlot)) {
    return err(
      domainError("SLOT_NOT_SERVED", `This mess does not serve ${input.mealSlot.toLowerCase()}.`, {
        slot: input.mealSlot,
      }),
    );
  }

  const daysFromToday = differenceInDays(input.today, input.serviceDate);
  if (daysFromToday < -MAX_DAYS_IN_PAST) {
    return err(
      domainError("VALIDATION_FAILED", "That date has already passed. Check the date you chose."),
    );
  }
  if (daysFromToday > MAX_DAYS_AHEAD) {
    return err(
      domainError("VALIDATION_FAILED", `You can only plan up to ${MAX_DAYS_AHEAD} days ahead.`),
    );
  }

  const items = normalizeItems(input.items);
  if (items.length > MAX_ITEMS) {
    return err(
      domainError("VALIDATION_FAILED", `A menu cannot list more than ${MAX_ITEMS} items.`),
    );
  }
  if (items.some((item) => item.length > MAX_ITEM_LENGTH)) {
    return err(domainError("VALIDATION_FAILED", "One of those items is too long."));
  }

  const notes = input.notes.trim();
  if (notes.length > MAX_NOTES_LENGTH) {
    return err(domainError("VALIDATION_FAILED", "That note is too long."));
  }

  // An empty menu with no explanation renders as a blank panel, which reads as
  // "the app is broken" rather than "nothing is being served".
  if (items.length === 0 && notes.length === 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "Add at least one item, or a note explaining why there is no menu.",
      ),
    );
  }

  return ok({
    serviceDate: input.serviceDate,
    mealSlot: input.mealSlot,
    items,
    notes: notes.length > 0 ? notes : null,
  });
}

/**
 * Trims, drops blanks, and removes case-insensitive duplicates while keeping
 * insertion order — which is the order the kitchen intends to serve in.
 */
function normalizeItems(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of items) {
    const item = raw.trim();
    if (item.length === 0) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

// --- Service state --------------------------------------------------------

export interface ServiceSlot {
  readonly slot: MealSlot;
  readonly serviceDate: ServiceDate;
  readonly opensAt: Date;
  readonly closesAt: Date;
}

export interface ServiceState {
  /** The tenant's current calendar day. */
  readonly serviceDate: ServiceDate;
  /** The meal being served right now, if any. */
  readonly current?: ServiceSlot;
  /** The next meal to open — tomorrow's first once today's last has closed. */
  readonly next?: ServiceSlot;
}

export interface ServiceStateRequest {
  readonly timeZone: string;
  readonly now: Date;
  readonly slots: readonly MealSlotConfig[];
}

/**
 * Resolves what is being served and what is next.
 *
 * Checks today's windows and then tomorrow's, so at 23:00 — after the last
 * service has closed — "next" is tomorrow's first meal rather than nothing.
 */
export function resolveServiceState(request: ServiceStateRequest): ServiceState {
  const { timeZone, now, slots } = request;
  const serviceDate = serviceDateOf(timeZone, now);

  if (slots.length === 0) return { serviceDate };

  // Ordered by time of day, not by however the settings JSON happened to be
  // written, so "next" is genuinely the next one.
  const ordered = [...slots].sort(
    (a, b) => ALL_MEAL_SLOTS.indexOf(a.slot) - ALL_MEAL_SLOTS.indexOf(b.slot),
  );

  const windowsFor = (date: ServiceDate): ServiceSlot[] =>
    ordered.map((config) => {
      const window = mealWindowOn(timeZone, date, config);
      return {
        slot: config.slot,
        serviceDate: date,
        opensAt: window.opensAt,
        closesAt: window.closesAt,
      };
    });

  // Yesterday's windows are included because a late dinner (22:00–00:30) is
  // still being served after midnight, when the service date has already rolled.
  const yesterday = windowsFor(addDays(serviceDate, -1));
  const today = windowsFor(serviceDate);
  const tomorrow = windowsFor(addDays(serviceDate, 1));

  const current = [...yesterday, ...today].find((s) =>
    isWithinWindow(now, { opensAt: s.opensAt, closesAt: s.closesAt }),
  );

  const next = [...today, ...tomorrow]
    .filter((s) => s.opensAt.getTime() > now.getTime())
    .sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime())[0];

  return {
    serviceDate,
    ...(current ? { current } : {}),
    ...(next ? { next } : {}),
  };
}

/** Whether `date` is in the past relative to the tenant's today. */
export function isPastServiceDate(date: ServiceDate, today: ServiceDate): boolean {
  return compareServiceDates(date, today) < 0;
}
