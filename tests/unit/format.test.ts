/**
 * Render-boundary formatting. Pure string work, but it is what the mess owner
 * actually reads, and a date rendered in the browser's timezone instead of the
 * hostel's would show the wrong day for half the evening.
 */
import { describe, expect, it } from "vitest";
import { formatServiceDate, formatDateTime, formatRelativeDay } from "@/lib/format";
import { toServiceDate } from "@/core/time";

describe("formatServiceDate", () => {
  it("renders a plain date without applying any timezone shift", () => {
    // A ServiceDate is already tenant-local. Passing it through `new Date(...)`
    // and a timezone-aware formatter is what produces off-by-one days, so this
    // asserts the calendar date survives verbatim.
    expect(formatServiceDate(toServiceDate("2026-07-31"))).toBe("31 Jul 2026");
  });

  it("renders the first of a month correctly", () => {
    expect(formatServiceDate(toServiceDate("2026-01-01"))).toBe("1 Jan 2026");
  });

  it("renders a leap day", () => {
    expect(formatServiceDate(toServiceDate("2028-02-29"))).toBe("29 Feb 2028");
  });

  it("returns a dash for null, so callers do not print 'null'", () => {
    expect(formatServiceDate(null)).toBe("—");
  });

  it("returns the raw value when it is not a date, rather than throwing", () => {
    expect(formatServiceDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatDateTime", () => {
  it("renders an instant in the tenant's timezone, not the server's", () => {
    // 20:00 UTC is 01:30 the next day in Kolkata. Rendering in UTC would show
    // an audit entry under the wrong date.
    const out = formatDateTime(new Date("2026-07-30T20:00:00Z"), "Asia/Kolkata");
    expect(out).toContain("31 Jul 2026");
    expect(out).toContain("01:30");
  });

  it("renders the same instant differently for a different tenant timezone", () => {
    const instant = new Date("2026-07-30T20:00:00Z");
    expect(formatDateTime(instant, "Asia/Kolkata")).not.toBe(
      formatDateTime(instant, "America/New_York"),
    );
  });

  it("uses 24-hour time, so 8pm service is never confused with 8am", () => {
    const out = formatDateTime(new Date("2026-07-30T14:30:00Z"), "Asia/Kolkata"); // 20:00 IST
    expect(out).toContain("20:00");
    expect(out).not.toMatch(/[ap]m/i);
  });

  it("returns a dash for null", () => {
    expect(formatDateTime(null, "Asia/Kolkata")).toBe("—");
  });
});

describe("formatRelativeDay", () => {
  const today = toServiceDate("2026-07-25");

  it("says Today for the tenant's current day", () => {
    expect(formatRelativeDay(toServiceDate("2026-07-25"), today)).toBe("Today");
  });

  it("says Tomorrow and Yesterday for the adjacent days", () => {
    expect(formatRelativeDay(toServiceDate("2026-07-26"), today)).toBe("Tomorrow");
    expect(formatRelativeDay(toServiceDate("2026-07-24"), today)).toBe("Yesterday");
  });

  it("falls back to an absolute date beyond one day, which is less ambiguous", () => {
    expect(formatRelativeDay(toServiceDate("2026-07-28"), today)).toBe("28 Jul 2026");
  });

  it("counts days remaining for a future date when asked", () => {
    expect(formatRelativeDay(toServiceDate("2026-07-31"), today, { withCountdown: true })).toBe(
      "31 Jul 2026 (in 6 days)",
    );
  });

  it("marks an expired date as overdue, not as a negative countdown", () => {
    expect(formatRelativeDay(toServiceDate("2026-07-20"), today, { withCountdown: true })).toBe(
      "20 Jul 2026 (5 days ago)",
    );
  });
});
