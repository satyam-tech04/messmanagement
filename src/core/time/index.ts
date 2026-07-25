/**
 * Tenant-local time (architecture doc §2.9).
 *
 * The rule: instants are stored as UTC `timestamptz`; a `service_date` is a
 * plain calendar date derived in the **tenant's** timezone. "Today's menu", the
 * daily headcount, the meal window and the mess-cut cutoff all key off the
 * hostel's local day boundary, not UTC's.
 *
 * Concretely, for a tenant in Asia/Kolkata (UTC+5:30): dinner served at 21:00
 * local on 5 July is 15:30Z on 5 July — same date either way. But a scan at
 * 00:30 local on 6 July is 19:00Z on *5* July. Deriving the service date from
 * the UTC instant would file that meal under the wrong day, corrupting both the
 * headcount and the attendance uniqueness guarantee. Every date derivation in
 * this codebase goes through this module. Never call
 * `new Date().toISOString().slice(0, 10)`.
 *
 * Implemented on `Intl.DateTimeFormat`, which carries the full IANA database,
 * so this stays correct for tenants in DST-observing zones even though the
 * launch customer is not in one. No third-party date dependency.
 */

/** A plain calendar date, `YYYY-MM-DD`. Carries no timezone of its own. */
export type ServiceDate = string & { readonly __brand: "ServiceDate" };

/** A wall-clock time of day, `HH:MM` in 24-hour form. */
export type WallClockTime = string & { readonly __brand: "WallClockTime" };

export interface MealWindow {
  /** Instant the counter opens. */
  readonly opensAt: Date;
  /** Instant the counter closes. Exclusive. */
  readonly closesAt: Date;
}

const SERVICE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WALL_CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Intl.DateTimeFormat construction is comparatively expensive and these are
// called once per scan; at 200 scans in a 20-minute window that adds up.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    // Fail loudly. A silently-wrong timezone shifts every derived date.
    throw new RangeError(`Unknown IANA timezone: ${timeZone}`);
  }

  formatterCache.set(timeZone, formatter);
  return formatter;
}

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockPartsIn(timeZone: string, instant: Date): WallClockParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`Intl did not return a '${type}' part for ${timeZone}`);
    return Number(found.value);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/**
 * Offset of `timeZone` from UTC at `instant`, in milliseconds.
 * Positive east of Greenwich (Asia/Kolkata → +19_800_000).
 */
function offsetMsAt(timeZone: string, instant: Date): number {
  const p = wallClockPartsIn(timeZone, instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Intl truncates to whole seconds; align the comparison to avoid a
  // sub-second offset drifting the result.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------
// Constructors and guards
// ---------------------------------------------------------------------------

export function isServiceDate(value: string): value is ServiceDate {
  if (!SERVICE_DATE_RE.test(value)) return false;
  // Reject calendar-invalid strings like 2026-02-30 that pass the shape test.
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function toServiceDate(value: string): ServiceDate {
  if (!isServiceDate(value)) {
    throw new RangeError(`Not a valid YYYY-MM-DD service date: ${value}`);
  }
  return value;
}

export function isWallClockTime(value: string): value is WallClockTime {
  return WALL_CLOCK_RE.test(value);
}

export function toWallClockTime(value: string): WallClockTime {
  if (!isWallClockTime(value)) {
    throw new RangeError(`Not a valid HH:MM wall-clock time: ${value}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Deriving dates from instants
// ---------------------------------------------------------------------------

/** The tenant-local calendar date on which `instant` falls. */
export function serviceDateOf(timeZone: string, instant: Date): ServiceDate {
  const p = wallClockPartsIn(timeZone, instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}` as ServiceDate;
}

/** The tenant-local time of day at `instant`. */
export function wallClockTimeOf(timeZone: string, instant: Date): WallClockTime {
  const p = wallClockPartsIn(timeZone, instant);
  return `${pad2(p.hour)}:${pad2(p.minute)}` as WallClockTime;
}

/**
 * The UTC instant at which `time` occurs on `date` in `timeZone`.
 *
 * Resolving a wall clock to an instant is genuinely ambiguous around DST
 * transitions, so the offset is probed twice — once at a naive guess, then
 * again at the corrected instant — and the result is verified by formatting it
 * back. The two irregular cases resolve the way `Temporal`'s `compatible`
 * disambiguation does, which is also what date-fns-tz and Java's
 * `java.time` pick:
 *
 * - **Gap** (spring-forward; 02:30 simply does not occur): shift forward past
 *   the gap, so 02:30 resolves to 03:30 local. The round-trip check is what
 *   detects this — without it the two-probe algorithm silently returns 01:30,
 *   an hour *before* the requested time.
 * - **Ambiguity** (autumn-back; 01:30 occurs twice): take the first, still-DST
 *   occurrence.
 *
 * India does not observe DST, so neither case arises for the launch customer —
 * but a tenant elsewhere would hit them twice a year, and a meal window that
 * silently moves an hour is exactly the bug §2.9 warns about.
 */
export function zonedInstant(timeZone: string, date: ServiceDate, time: WallClockTime): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];

  const naiveUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Probe 1: offset as if the wall clock were UTC. Correct except near a
  // transition, where it may be the offset on the wrong side of the boundary.
  const firstGuess = new Date(naiveUtc - offsetMsAt(timeZone, new Date(naiveUtc)));
  // Probe 2: offset at (approximately) the real instant.
  const candidate = new Date(naiveUtc - offsetMsAt(timeZone, firstGuess));

  const actual = wallClockPartsIn(timeZone, candidate);
  const roundTrips =
    actual.year === y &&
    actual.month === m &&
    actual.day === d &&
    actual.hour === hh &&
    actual.minute === mm;

  // A failed round-trip means the requested local time does not exist. The
  // first guess uses the pre-transition offset, which lands just past the gap.
  return roundTrips ? candidate : firstGuess;
}

/** The instant tenant-local midnight begins on `date`. */
export function startOfServiceDate(timeZone: string, date: ServiceDate): Date {
  return zonedInstant(timeZone, date, "00:00" as WallClockTime);
}

/** The instant tenant-local midnight begins on the following day (exclusive end). */
export function endOfServiceDate(timeZone: string, date: ServiceDate): Date {
  return startOfServiceDate(timeZone, addDays(date, 1));
}

// ---------------------------------------------------------------------------
// Plain-date arithmetic
//
// Pure calendar maths, done in UTC internally so it can never be perturbed by a
// DST shift. A ServiceDate has no timezone, so "add one day" always means "the
// next calendar square", never "24 hours later".
// ---------------------------------------------------------------------------

function toUtcMillis(date: ServiceDate): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUtcMillis(ms: number): ServiceDate {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}` as ServiceDate;
}

const DAY_MS = 86_400_000;

export function addDays(date: ServiceDate, days: number): ServiceDate {
  return fromUtcMillis(toUtcMillis(date) + days * DAY_MS);
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function differenceInDays(from: ServiceDate, to: ServiceDate): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / DAY_MS);
}

export function compareServiceDates(a: ServiceDate, b: ServiceDate): number {
  // Zero-padded ISO dates sort correctly as plain strings.
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBefore(a: ServiceDate, b: ServiceDate): boolean {
  return a < b;
}

export function isAfter(a: ServiceDate, b: ServiceDate): boolean {
  return a > b;
}

/** Inclusive on both ends — subscription terms and mess-cut ranges both are. */
export function isWithinDateRange(date: ServiceDate, from: ServiceDate, to: ServiceDate): boolean {
  return date >= from && date <= to;
}

/** Every date from `from` to `to`, inclusive. Empty when `to` precedes `from`. */
export function eachDateInclusive(from: ServiceDate, to: ServiceDate): ServiceDate[] {
  const out: ServiceDate[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    out.push(cursor);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Month helpers
//
// The mess-cut cap is "per calendar month", and a cut spanning 28 Mar – 2 Apr
// must count 4 days against March and 2 against April, evaluated independently
// (§7.2). These make that accounting explicit rather than improvised.
// ---------------------------------------------------------------------------

/** `YYYY-MM` — the calendar month a date belongs to. */
export type MonthKey = string & { readonly __brand: "MonthKey" };

export function monthKeyOf(date: ServiceDate): MonthKey {
  return date.slice(0, 7) as MonthKey;
}

export function startOfMonth(date: ServiceDate): ServiceDate {
  return `${monthKeyOf(date)}-01` as ServiceDate;
}

export function endOfMonth(date: ServiceDate): ServiceDate {
  const [y, m] = date.split("-").map(Number) as [number, number];
  // Day 0 of the next month is the last day of this one.
  return fromUtcMillis(Date.UTC(y, m, 0));
}

export function daysInMonth(date: ServiceDate): number {
  return Number(endOfMonth(date).slice(8, 10));
}

/**
 * Splits an inclusive date range into one segment per calendar month it spans.
 * This is what makes month-boundary cap accounting correct instead of quietly
 * broken — the case §7.2 singles out as where implementations break.
 */
export function splitRangeByMonth(
  from: ServiceDate,
  to: ServiceDate,
): Array<{ month: MonthKey; from: ServiceDate; to: ServiceDate; days: number }> {
  if (isAfter(from, to)) return [];

  const segments: Array<{ month: MonthKey; from: ServiceDate; to: ServiceDate; days: number }> = [];
  let cursor = from;

  while (!isAfter(cursor, to)) {
    const monthEnd = endOfMonth(cursor);
    const segmentEnd = isBefore(monthEnd, to) ? monthEnd : to;
    segments.push({
      month: monthKeyOf(cursor),
      from: cursor,
      to: segmentEnd,
      days: differenceInDays(cursor, segmentEnd) + 1,
    });
    cursor = addDays(segmentEnd, 1);
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Meal windows
// ---------------------------------------------------------------------------

export interface MealWindowConfig {
  readonly start: WallClockTime;
  readonly end: WallClockTime;
}

/**
 * Resolves a configured meal window to concrete instants on `date`.
 *
 * A window whose end is not after its start is treated as crossing midnight
 * (dinner 22:00–00:30 is real in hostels that serve late). Without this, such a
 * window would resolve to a negative-length interval and reject every scan.
 */
export function mealWindowOn(
  timeZone: string,
  date: ServiceDate,
  config: MealWindowConfig,
): MealWindow {
  const opensAt = zonedInstant(timeZone, date, config.start);
  const crossesMidnight = config.end <= config.start;
  const closesAt = crossesMidnight
    ? zonedInstant(timeZone, addDays(date, 1), config.end)
    : zonedInstant(timeZone, date, config.end);
  return { opensAt, closesAt };
}

/** Start-inclusive, end-exclusive. */
export function isWithinWindow(instant: Date, window: MealWindow): boolean {
  const t = instant.getTime();
  return t >= window.opensAt.getTime() && t < window.closesAt.getTime();
}

/** Hours from `a` to `b`, fractional. Negative when `b` precedes `a`. */
export function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000;
}
