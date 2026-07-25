import { describe, it, expect } from "vitest";
import {
  addDays,
  compareServiceDates,
  daysInMonth,
  differenceInDays,
  eachDateInclusive,
  endOfMonth,
  endOfServiceDate,
  hoursBetween,
  isAfter,
  isBefore,
  isServiceDate,
  isWallClockTime,
  isWithinDateRange,
  isWithinWindow,
  mealWindowOn,
  monthKeyOf,
  serviceDateOf,
  splitRangeByMonth,
  startOfMonth,
  startOfServiceDate,
  toServiceDate,
  toWallClockTime,
  wallClockTimeOf,
  zonedInstant,
  type ServiceDate,
  type WallClockTime,
} from "@/core/time";

const IST = "Asia/Kolkata"; // UTC+5:30, no DST — the launch customer
const NY = "America/New_York"; // DST-observing, to prove the logic generalises
const d = (s: string): ServiceDate => toServiceDate(s);
const t = (s: string): WallClockTime => toWallClockTime(s);

describe("service date validation", () => {
  it("accepts well-formed dates", () => {
    expect(isServiceDate("2026-07-25")).toBe(true);
    expect(isServiceDate("2024-02-29")).toBe(true); // leap year
  });

  it("rejects malformed shapes", () => {
    expect(isServiceDate("2026-7-25")).toBe(false);
    expect(isServiceDate("25-07-2026")).toBe(false);
    expect(isServiceDate("")).toBe(false);
    expect(isServiceDate("2026-07-25T00:00:00Z")).toBe(false);
  });

  it("rejects calendar-invalid dates that pass the shape test", () => {
    expect(isServiceDate("2026-02-30")).toBe(false);
    expect(isServiceDate("2026-13-01")).toBe(false);
    expect(isServiceDate("2025-02-29")).toBe(false); // not a leap year
  });

  it("throws on construction from an invalid date", () => {
    expect(() => toServiceDate("2026-02-30")).toThrow(RangeError);
  });

  it("validates wall-clock times", () => {
    expect(isWallClockTime("00:00")).toBe(true);
    expect(isWallClockTime("23:59")).toBe(true);
    expect(isWallClockTime("24:00")).toBe(false);
    expect(isWallClockTime("12:60")).toBe(false);
    expect(isWallClockTime("9:30")).toBe(false);
    expect(() => toWallClockTime("24:00")).toThrow(RangeError);
  });
});

describe("serviceDateOf — the tenant-local day boundary", () => {
  it("derives the tenant's date, not UTC's", () => {
    // 19:00Z on 5 July is 00:30 IST on 6 July. A late dinner scan must be
    // filed under the tenant's 6th, not UTC's 5th.
    const instant = new Date("2026-07-05T19:00:00Z");
    expect(serviceDateOf(IST, instant)).toBe("2026-07-06");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-07-05"); // the naive answer, wrong
  });

  it("keeps a normal dinner on the same date in both zones", () => {
    // 21:00 IST on 5 July = 15:30Z on 5 July.
    expect(serviceDateOf(IST, new Date("2026-07-05T15:30:00Z"))).toBe("2026-07-05");
  });

  it("handles the reverse direction for a western tenant", () => {
    // 02:00Z on 6 July is 22:00 on the 5th in New York (EDT, UTC-4).
    expect(serviceDateOf(NY, new Date("2026-07-06T02:00:00Z"))).toBe("2026-07-05");
  });

  it("is exact at the tenant-local midnight boundary", () => {
    // 18:29:59Z -> 23:59:59 IST on the 5th; one second later flips the date.
    expect(serviceDateOf(IST, new Date("2026-07-05T18:29:59Z"))).toBe("2026-07-05");
    expect(serviceDateOf(IST, new Date("2026-07-05T18:30:00Z"))).toBe("2026-07-06");
  });

  it("reads the tenant-local time of day", () => {
    expect(wallClockTimeOf(IST, new Date("2026-07-05T15:30:00Z"))).toBe("21:00");
    expect(wallClockTimeOf(IST, new Date("2026-07-05T18:30:00Z"))).toBe("00:00");
  });

  it("throws on an unknown timezone rather than silently defaulting", () => {
    expect(() => serviceDateOf("Mars/Olympus_Mons", new Date())).toThrow(RangeError);
  });
});

describe("zonedInstant", () => {
  it("resolves a tenant wall-clock time to the correct UTC instant", () => {
    expect(zonedInstant(IST, d("2026-07-05"), t("12:00")).toISOString()).toBe(
      "2026-07-05T06:30:00.000Z",
    );
  });

  it("round-trips with serviceDateOf", () => {
    const instant = zonedInstant(IST, d("2026-07-05"), t("21:30"));
    expect(serviceDateOf(IST, instant)).toBe("2026-07-05");
    expect(wallClockTimeOf(IST, instant)).toBe("21:30");
  });

  it("gives tenant-local midnight as the start of a service date", () => {
    expect(startOfServiceDate(IST, d("2026-07-05")).toISOString()).toBe("2026-07-04T18:30:00.000Z");
  });

  it("ends a service date at the next day's local midnight", () => {
    expect(endOfServiceDate(IST, d("2026-07-05")).toISOString()).toBe("2026-07-05T18:30:00.000Z");
  });

  it("applies the correct offset either side of a DST transition", () => {
    // US DST began 2026-03-08. Noon on the 7th is EST (-5), on the 9th EDT (-4).
    expect(zonedInstant(NY, d("2026-03-07"), t("12:00")).toISOString()).toBe(
      "2026-03-07T17:00:00.000Z",
    );
    expect(zonedInstant(NY, d("2026-03-09"), t("12:00")).toISOString()).toBe(
      "2026-03-09T16:00:00.000Z",
    );
  });

  it("shifts forward past a spring-forward gap rather than backwards", () => {
    // 02:30 on 2026-03-08 never occurs in New York; clocks jump 02:00 -> 03:00.
    // We resolve forward past the gap (03:30 local), matching Temporal's
    // `compatible` disambiguation. Resolving backwards to 01:30 would move a
    // meal window an hour earlier than configured.
    const resolved = zonedInstant(NY, d("2026-03-08"), t("02:30"));
    expect(resolved.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(wallClockTimeOf(NY, resolved)).toBe("03:30");
  });

  it("takes the first occurrence of a time repeated by autumn-back", () => {
    // 01:30 on 2026-11-01 occurs twice in New York; clocks fall 02:00 -> 01:00.
    // The first (still-EDT, UTC-4) occurrence is the conventional choice.
    const resolved = zonedInstant(NY, d("2026-11-01"), t("01:30"));
    expect(resolved.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(wallClockTimeOf(NY, resolved)).toBe("01:30");
  });
});

describe("plain-date arithmetic", () => {
  it("adds and subtracts days across month and year boundaries", () => {
    expect(addDays(d("2026-07-05"), 1)).toBe("2026-07-06");
    expect(addDays(d("2026-07-31"), 1)).toBe("2026-08-01");
    expect(addDays(d("2026-12-31"), 1)).toBe("2027-01-01");
    expect(addDays(d("2026-01-01"), -1)).toBe("2025-12-31");
    expect(addDays(d("2024-02-28"), 1)).toBe("2024-02-29"); // leap year
    expect(addDays(d("2025-02-28"), 1)).toBe("2025-03-01");
  });

  it("is unaffected by DST — a day is a calendar square, not 24 hours", () => {
    // Adding a day across a spring-forward must still advance exactly one date.
    expect(addDays(d("2026-03-07"), 1)).toBe("2026-03-08");
    expect(addDays(d("2026-03-08"), 1)).toBe("2026-03-09");
  });

  it("measures whole days between dates", () => {
    expect(differenceInDays(d("2026-07-05"), d("2026-07-10"))).toBe(5);
    expect(differenceInDays(d("2026-07-10"), d("2026-07-05"))).toBe(-5);
    expect(differenceInDays(d("2026-07-05"), d("2026-07-05"))).toBe(0);
    expect(differenceInDays(d("2026-02-28"), d("2026-03-01"))).toBe(1);
  });

  it("compares and orders dates", () => {
    expect(compareServiceDates(d("2026-07-05"), d("2026-07-06"))).toBe(-1);
    expect(compareServiceDates(d("2026-07-06"), d("2026-07-05"))).toBe(1);
    expect(compareServiceDates(d("2026-07-05"), d("2026-07-05"))).toBe(0);
    expect(isBefore(d("2026-07-05"), d("2026-07-06"))).toBe(true);
    expect(isAfter(d("2026-07-06"), d("2026-07-05"))).toBe(true);
  });

  it("treats date ranges as inclusive on both ends", () => {
    expect(isWithinDateRange(d("2026-07-05"), d("2026-07-05"), d("2026-07-10"))).toBe(true);
    expect(isWithinDateRange(d("2026-07-10"), d("2026-07-05"), d("2026-07-10"))).toBe(true);
    expect(isWithinDateRange(d("2026-07-04"), d("2026-07-05"), d("2026-07-10"))).toBe(false);
    expect(isWithinDateRange(d("2026-07-11"), d("2026-07-05"), d("2026-07-10"))).toBe(false);
  });

  it("enumerates an inclusive range", () => {
    expect(eachDateInclusive(d("2026-07-05"), d("2026-07-08"))).toEqual([
      "2026-07-05",
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
    ]);
    expect(eachDateInclusive(d("2026-07-05"), d("2026-07-05"))).toEqual(["2026-07-05"]);
    expect(eachDateInclusive(d("2026-07-08"), d("2026-07-05"))).toEqual([]);
  });
});

describe("month helpers", () => {
  it("derives month keys and bounds", () => {
    expect(monthKeyOf(d("2026-07-25"))).toBe("2026-07");
    expect(startOfMonth(d("2026-07-25"))).toBe("2026-07-01");
    expect(endOfMonth(d("2026-07-25"))).toBe("2026-07-31");
    expect(endOfMonth(d("2026-02-10"))).toBe("2026-02-28");
    expect(endOfMonth(d("2024-02-10"))).toBe("2024-02-29");
  });

  it("counts days in a month", () => {
    expect(daysInMonth(d("2026-07-01"))).toBe(31);
    expect(daysInMonth(d("2026-04-15"))).toBe(30);
    expect(daysInMonth(d("2026-02-01"))).toBe(28);
    expect(daysInMonth(d("2024-02-01"))).toBe(29);
  });
});

describe("splitRangeByMonth — the month-boundary case from §7.2", () => {
  it("counts 28 Mar – 2 Apr as 4 days in March and 2 in April", () => {
    expect(splitRangeByMonth(d("2026-03-28"), d("2026-04-02"))).toEqual([
      { month: "2026-03", from: "2026-03-28", to: "2026-03-31", days: 4 },
      { month: "2026-04", from: "2026-04-01", to: "2026-04-02", days: 2 },
    ]);
  });

  it("returns a single segment for a range inside one month", () => {
    expect(splitRangeByMonth(d("2026-07-05"), d("2026-07-09"))).toEqual([
      { month: "2026-07", from: "2026-07-05", to: "2026-07-09", days: 5 },
    ]);
  });

  it("handles a single-day range", () => {
    expect(splitRangeByMonth(d("2026-07-05"), d("2026-07-05"))).toEqual([
      { month: "2026-07", from: "2026-07-05", to: "2026-07-05", days: 1 },
    ]);
  });

  it("spans three months and a year boundary", () => {
    const segments = splitRangeByMonth(d("2026-11-28"), d("2027-01-03"));
    expect(segments).toEqual([
      { month: "2026-11", from: "2026-11-28", to: "2026-11-30", days: 3 },
      { month: "2026-12", from: "2026-12-01", to: "2026-12-31", days: 31 },
      { month: "2027-01", from: "2027-01-01", to: "2027-01-03", days: 3 },
    ]);
    expect(segments.reduce((sum, s) => sum + s.days, 0)).toBe(
      differenceInDays(d("2026-11-28"), d("2027-01-03")) + 1,
    );
  });

  it("handles February in a leap year", () => {
    expect(splitRangeByMonth(d("2024-02-27"), d("2024-03-01"))).toEqual([
      { month: "2024-02", from: "2024-02-27", to: "2024-02-29", days: 3 },
      { month: "2024-03", from: "2024-03-01", to: "2024-03-01", days: 1 },
    ]);
  });

  it("returns nothing for an inverted range", () => {
    expect(splitRangeByMonth(d("2026-07-09"), d("2026-07-05"))).toEqual([]);
  });
});

describe("meal windows", () => {
  const lunch = { start: t("12:00"), end: t("14:30") };

  it("resolves a window to tenant-local instants", () => {
    const w = mealWindowOn(IST, d("2026-07-05"), lunch);
    expect(w.opensAt.toISOString()).toBe("2026-07-05T06:30:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2026-07-05T09:00:00.000Z");
  });

  it("admits scans inside the window, start-inclusive and end-exclusive", () => {
    const w = mealWindowOn(IST, d("2026-07-05"), lunch);
    expect(isWithinWindow(new Date("2026-07-05T06:30:00Z"), w)).toBe(true); // 12:00 sharp
    expect(isWithinWindow(new Date("2026-07-05T07:45:00Z"), w)).toBe(true); // 13:15
    expect(isWithinWindow(new Date("2026-07-05T08:59:59Z"), w)).toBe(true); // 14:29:59
    expect(isWithinWindow(new Date("2026-07-05T09:00:00Z"), w)).toBe(false); // 14:30 sharp
    expect(isWithinWindow(new Date("2026-07-05T06:29:59Z"), w)).toBe(false); // 11:59:59
  });

  it("treats a window ending at or before its start as crossing midnight", () => {
    // Late dinner 22:00 -> 00:30 the next morning.
    const w = mealWindowOn(IST, d("2026-07-05"), { start: t("22:00"), end: t("00:30") });
    expect(w.opensAt.toISOString()).toBe("2026-07-05T16:30:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2026-07-05T19:00:00.000Z");
    expect(w.closesAt.getTime()).toBeGreaterThan(w.opensAt.getTime());
    // 00:15 IST on the 6th still belongs to the 5th's dinner service.
    expect(isWithinWindow(new Date("2026-07-05T18:45:00Z"), w)).toBe(true);
  });
});

describe("hoursBetween", () => {
  it("measures fractional hours and direction", () => {
    const a = new Date("2026-07-05T06:00:00Z");
    expect(hoursBetween(a, new Date("2026-07-05T18:00:00Z"))).toBe(12);
    expect(hoursBetween(a, new Date("2026-07-05T05:00:00Z"))).toBe(-1);
    expect(hoursBetween(a, new Date("2026-07-05T06:30:00Z"))).toBe(0.5);
  });

  it("supports the 12-hour cutoff comparison used by the mess-cut policy", () => {
    // A request at 23:59 for the next day's 12:00 lunch is 12h01m ahead.
    const requestedAt = zonedInstant(IST, d("2026-07-04"), t("23:59"));
    const mealOpensAt = zonedInstant(IST, d("2026-07-05"), t("12:00"));
    expect(hoursBetween(requestedAt, mealOpensAt)).toBeCloseTo(12.0167, 3);
  });
});
