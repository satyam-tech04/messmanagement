/**
 * Importing a mess's weekly menu from its own spreadsheet.
 *
 * The document a mess hands you is one table holding two different things: a
 * weekly rotation of dishes, and a short list of separately-priced extras —
 * tea, a chapati, a plate of rice. The first is a menu; the second is the
 * counter-sales catalogue. A row is told apart by whether it names a day and a
 * meal, and anything that fits neither is reported rather than guessed at.
 *
 * ## The price column is deliberately dropped (D-25)
 *
 * Each day's meal carries a price — Monday breakfast ₹40, Friday dinner ₹120.
 * It describes what a walk-in would pay for that day's food, and nothing in
 * this system charges for that yet. `menus` has no price, `meal_prices` holds
 * one rate per slot for the whole mess rather than per day, and `counter_items`
 * are fixed-price named things. Finding it a home would have meant inventing a
 * business rule, so it is ignored until somebody decides what it means.
 *
 * ## Every problem at once
 *
 * A bad row never stops the parse. An admin importing a month of food wants one
 * list of everything wrong with the sheet, not to fix a typo, re-upload, and
 * discover the next one.
 */
import type { MealSlot } from "@/core/domain/enums";
import { rupeesToPaise, type Paise } from "@/core/money";
import { addDays, compareServiceDates, type ServiceDate } from "@/core/time";

/** Sunday is 0, matching `Date.getUTCDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const WEEKDAYS: Readonly<Record<string, Weekday>> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const SLOTS: Record<string, MealSlot> = {
  breakfast: "BREAKFAST",
  lunch: "LUNCH",
  snacks: "SNACKS",
  snack: "SNACKS",
  dinner: "DINNER",
};

/** A unit is required on a counter item; the sheet does not carry one. */
const DEFAULT_UNIT = "Each";

export interface MenuImportError {
  readonly rowNumber: number;
  readonly column: string;
  readonly message: string;
}

/** One cell of the weekly rotation: this weekday, this meal, these dishes. */
export interface WeeklyMenuEntry {
  readonly weekday: Weekday;
  readonly mealSlot: MealSlot;
  readonly items: readonly string[];
}

export interface ImportedCounterItem {
  readonly itemName: string;
  readonly pricePaise: Paise;
  readonly unit: string;
}

export interface MenuImportRequest {
  /** Raw CSV rows, header included. */
  readonly rows: readonly (readonly string[])[];
  /** The meals this mess actually serves, from tenant settings. */
  readonly servedSlots: readonly MealSlot[];
}

export interface MenuImportPreview {
  readonly menu: readonly WeeklyMenuEntry[];
  readonly counterItems: readonly ImportedCounterItem[];
  readonly errors: readonly MenuImportError[];
}

const cell = (row: readonly string[], index: number): string => (row[index] ?? "").trim();

/**
 * Reads a rupee figure as a spreadsheet writes it.
 *
 * "₹1,250" and "1250.00" are the same number; only the digits and a decimal
 * point survive. Returns null for anything that is not a number at all, which
 * the caller reports rather than treating as zero.
 */
function parseRupees(raw: string): number | null {
  const cleaned = raw.replace(/[₹,\s]/g, "");
  if (cleaned.length === 0) return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function parseMenuImport(request: MenuImportRequest): MenuImportPreview {
  const menu: WeeklyMenuEntry[] = [];
  const counterItems: ImportedCounterItem[] = [];
  const errors: MenuImportError[] = [];

  const seenMenu = new Set<string>();
  const seenItems = new Set<string>();

  // Row 1 is the header the spreadsheet wrote; numbering starts at 2 so the
  // admin can find a bad row by the number their own editor shows.
  for (let i = 1; i < request.rows.length; i += 1) {
    const row = request.rows[i] ?? [];
    const rowNumber = i + 1;

    const dayRaw = cell(row, 0);
    const mealRaw = cell(row, 1);
    const nameRaw = cell(row, 2);
    const priceRaw = cell(row, 3);

    // A blank separator row. Spreadsheets are full of them.
    if (!dayRaw && !mealRaw && !nameRaw && !priceRaw) continue;

    // --- The weekly rotation -----------------------------------------------
    if (dayRaw || mealRaw) {
      const weekday = WEEKDAYS[dayRaw.toLowerCase()];
      if (weekday === undefined) {
        errors.push({ rowNumber, column: "Day", message: `"${dayRaw}" is not a day of the week.` });
        continue;
      }

      const mealSlot = SLOTS[mealRaw.toLowerCase()];
      if (!mealSlot) {
        errors.push({ rowNumber, column: "Meal", message: `"${mealRaw}" is not a meal.` });
        continue;
      }
      if (!request.servedSlots.includes(mealSlot)) {
        errors.push({
          rowNumber,
          column: "Meal",
          message: `This mess does not serve ${mealSlot.toLowerCase()}. Add the meal time under Settings first, or remove these rows.`,
        });
        continue;
      }

      const items = nameRaw
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (items.length === 0) {
        errors.push({
          rowNumber,
          column: "Menu Items",
          message: "No dishes listed for this meal.",
        });
        continue;
      }

      // Two rows for the same day and meal means whichever lands last silently
      // wins, and the admin never learns which.
      const key = `${weekday}|${mealSlot}`;
      if (seenMenu.has(key)) {
        errors.push({
          rowNumber,
          column: "Day",
          message: `${dayRaw} ${mealRaw.toLowerCase()} is already listed earlier in the sheet.`,
        });
        continue;
      }
      seenMenu.add(key);

      menu.push({ weekday, mealSlot, items });
      continue;
    }

    // --- The extras block: a name and a price, no day, no meal --------------
    if (!nameRaw) continue;

    // A section heading such as "Extras" — a label with no price. Skipped
    // rather than reported, because the sheet legitimately contains one.
    if (!priceRaw) continue;

    const rupees = parseRupees(priceRaw);
    if (rupees === null) {
      errors.push({
        rowNumber,
        column: "Price",
        message: `"${priceRaw}" is not a price.`,
      });
      continue;
    }
    if (rupees <= 0) {
      errors.push({
        rowNumber,
        column: "Price",
        message: "A price must be more than zero.",
      });
      continue;
    }

    const nameKey = nameRaw.toLowerCase();
    if (seenItems.has(nameKey)) {
      errors.push({
        rowNumber,
        column: "Menu Items",
        message: `"${nameRaw}" is already listed earlier in the sheet.`,
      });
      continue;
    }
    seenItems.add(nameKey);

    let pricePaise: Paise;
    try {
      pricePaise = rupeesToPaise(rupees);
    } catch {
      errors.push({ rowNumber, column: "Price", message: "That price is too large." });
      continue;
    }

    counterItems.push({ itemName: nameRaw, pricePaise, unit: DEFAULT_UNIT });
  }

  if (menu.length === 0 && counterItems.length === 0 && errors.length === 0) {
    errors.push({
      rowNumber: 0,
      column: "File",
      message: "There is nothing to import in this file.",
    });
  }

  return { menu, counterItems, errors };
}

// ---------------------------------------------------------------------------
// One week, across a month
// ---------------------------------------------------------------------------

export interface ExpandedMenuDay {
  readonly serviceDate: ServiceDate;
  readonly mealSlot: MealSlot;
  readonly items: readonly string[];
}

/**
 * Lays the weekly rotation onto every matching date between `from` and `to`,
 * inclusive at both ends.
 *
 * Weekday comes from `Date.getUTCDay()` on the plain date string rather than a
 * local `Date`, so the answer cannot shift by one in a timezone behind UTC. The
 * dates here are calendar dates the tenant already derived; they carry no zone
 * of their own and must not acquire one here.
 */
export function expandWeeklyMenu(
  week: readonly WeeklyMenuEntry[],
  from: ServiceDate,
  to: ServiceDate,
): ExpandedMenuDay[] {
  if (compareServiceDates(from, to) > 0) return [];

  const byWeekday = new Map<Weekday, WeeklyMenuEntry[]>();
  for (const entry of week) {
    const existing = byWeekday.get(entry.weekday);
    if (existing) existing.push(entry);
    else byWeekday.set(entry.weekday, [entry]);
  }

  const days: ExpandedMenuDay[] = [];
  let cursor = from;
  while (compareServiceDates(cursor, to) <= 0) {
    const weekday = new Date(`${cursor}T00:00:00Z`).getUTCDay() as Weekday;
    for (const entry of byWeekday.get(weekday) ?? []) {
      days.push({ serviceDate: cursor, mealSlot: entry.mealSlot, items: entry.items });
    }
    cursor = addDays(cursor, 1);
  }
  return days;
}
