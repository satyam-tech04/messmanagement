/**
 * Render-boundary formatting (DESIGN.md §4).
 *
 * Money and dates are formatted here and nowhere else — never in a query, never
 * in the domain. `src/lib` is a leaf: it may import `src/core` for types but
 * nothing may depend on it from `src/core` or `src/infra`.
 */
import {
  compareServiceDates,
  differenceInDays,
  isServiceDate,
  serviceDateOf,
  type ServiceDate,
} from "@/core/time";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Formats a plain calendar date: "2026-07-31" -> "31 Jul 2026".
 *
 * A `ServiceDate` is already the tenant's local day. Parsing it into a `Date`
 * and running it through `Intl` would re-interpret it as UTC midnight and, for
 * any viewer west of Greenwich, render the previous day. So the parts are split
 * as text — no `Date` is constructed at all.
 */
export function formatServiceDate(date: ServiceDate | string | null | undefined): string {
  if (!date) return "—";
  if (!isServiceDate(date)) return date;

  const [year, month, day] = date.split("-");
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return date;

  return `${Number(day)} ${monthName} ${year}`;
}

/**
 * Formats an instant in the tenant's timezone, 24-hour.
 *
 * 24-hour because this is read by staff mid-service: "20:00" cannot be misread
 * as morning, whereas a missed "pm" can send someone to the wrong sitting.
 */
export function formatDateTime(
  instant: Date | string | null | undefined,
  timeZone: string,
): string {
  if (!instant) return "—";
  const value = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(value.getTime())) return "—";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${Number(get("day"))} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

/**
 * "Today" / "Tomorrow" / "Yesterday", falling back to an absolute date.
 *
 * Relative labels only within one day: "in 3 days" forces the reader to do
 * arithmetic to know whether that is before or after the weekend, so beyond the
 * adjacent days the absolute date is clearer.
 *
 * Takes no timezone: both arguments are already tenant-local `ServiceDate`s.
 * Accepting one would imply a conversion happens here, and the next caller would
 * pass a UTC instant expecting it to be handled.
 */
export function formatRelativeDay(
  date: ServiceDate,
  today: ServiceDate,
  options: { withCountdown?: boolean } = {},
): string {
  const delta = differenceInDays(today, date);

  if (!options.withCountdown) {
    if (delta === 0) return "Today";
    if (delta === 1) return "Tomorrow";
    if (delta === -1) return "Yesterday";
    return formatServiceDate(date);
  }

  const absolute = formatServiceDate(date);
  if (delta === 0) return `${absolute} (today)`;

  const magnitude = Math.abs(delta);
  const noun = magnitude === 1 ? "day" : "days";
  return delta > 0
    ? `${absolute} (in ${magnitude} ${noun})`
    : `${absolute} (${magnitude} ${noun} ago)`;
}

/** The tenant's current service date — the reference point for the helpers above. */
export function todayIn(timeZone: string): ServiceDate {
  return serviceDateOf(timeZone, new Date());
}

/** Whether a subscription end date has already passed in the tenant's timezone. */
export function hasExpired(endDate: ServiceDate, timeZone: string): boolean {
  return compareServiceDates(endDate, todayIn(timeZone)) < 0;
}
