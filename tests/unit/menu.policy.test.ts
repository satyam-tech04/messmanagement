/**
 * Tests for the menu policy.
 *
 * Written before the implementation. The service-state cases matter most: they
 * decide what a student sees when they open the app at 13:00 versus 23:00, and
 * getting the day boundary wrong shows tomorrow's dinner to someone standing in
 * tonight's queue.
 */
import { describe, expect, it } from "vitest";
import { MealSlot, UserRole } from "@/core/domain/enums";
import type { MealSlotConfig } from "@/core/domain/tenant-context";
import {
  parseMenuDraft,
  resolveServiceState,
  type MenuDraftInput,
} from "@/core/policies/menu.policy";
import { toServiceDate, toWallClockTime } from "@/core/time";

const SLOTS: readonly MealSlotConfig[] = [
  { slot: MealSlot.LUNCH, start: toWallClockTime("12:00"), end: toWallClockTime("14:30") },
  { slot: MealSlot.DINNER, start: toWallClockTime("19:30"), end: toWallClockTime("22:00") },
];

const TZ = "Asia/Kolkata";

const validDraft: MenuDraftInput = {
  actorRole: UserRole.ADMIN,
  serviceDate: toServiceDate("2026-07-25"),
  mealSlot: MealSlot.LUNCH,
  items: ["Rice", "Dal Tadka", "Paneer Butter Masala"],
  notes: "",
  servedSlots: [MealSlot.LUNCH, MealSlot.DINNER],
  today: toServiceDate("2026-07-25"),
};

describe("parseMenuDraft — authorization", () => {
  it("allows an admin", () => {
    expect(parseMenuDraft(validDraft).ok).toBe(true);
  });

  it("refuses staff — the counter does not decide what is cooked", () => {
    const r = parseMenuDraft({ ...validDraft, actorRole: UserRole.STAFF });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("parseMenuDraft — items", () => {
  it("trims each item", () => {
    const r = parseMenuDraft({ ...validDraft, items: ["  Rice  ", "Dal"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items).toEqual(["Rice", "Dal"]);
  });

  it("drops blank items, which is what an empty row in the form produces", () => {
    const r = parseMenuDraft({ ...validDraft, items: ["Rice", "   ", "", "Dal"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items).toEqual(["Rice", "Dal"]);
  });

  it("removes case-insensitive duplicates, keeping the first spelling", () => {
    const r = parseMenuDraft({ ...validDraft, items: ["Rice", "RICE", "rice", "Dal"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items).toEqual(["Rice", "Dal"]);
  });

  it("preserves the order the kitchen entered — it is the serving order", () => {
    const r = parseMenuDraft({ ...validDraft, items: ["Dal", "Rice", "Salad"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items).toEqual(["Dal", "Rice", "Salad"]);
  });

  it("rejects an empty menu with no note — a blank screen tells a student nothing", () => {
    const r = parseMenuDraft({ ...validDraft, items: [], notes: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("allows an empty item list when a note explains it, e.g. a closure", () => {
    const r = parseMenuDraft({ ...validDraft, items: [], notes: "Mess closed for Diwali" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items).toEqual([]);
  });

  it("rejects an unreasonably long item name rather than truncating it", () => {
    const r = parseMenuDraft({ ...validDraft, items: ["x".repeat(201)] });
    expect(r.ok).toBe(false);
  });

  it("caps the number of items, so a paste accident cannot blow up the row", () => {
    const r = parseMenuDraft({
      ...validDraft,
      items: Array.from({ length: 51 }, (_, i) => `Item ${i}`),
    });
    expect(r.ok).toBe(false);
  });
});

describe("parseMenuDraft — slot and date", () => {
  it("refuses a slot the tenant does not serve", () => {
    // The tenant serves lunch and dinner. A breakfast menu would never be
    // reachable, and would silently never appear to anyone.
    const r = parseMenuDraft({ ...validDraft, mealSlot: MealSlot.BREAKFAST });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SLOT_NOT_SERVED");
  });

  it("allows publishing for today", () => {
    expect(parseMenuDraft({ ...validDraft, serviceDate: toServiceDate("2026-07-25") }).ok).toBe(
      true,
    );
  });

  it("allows publishing ahead, which is the normal weekly workflow", () => {
    const r = parseMenuDraft({ ...validDraft, serviceDate: toServiceDate("2026-08-01") });
    expect(r.ok).toBe(true);
  });

  it("refuses a date far in the past — that is a typo, not an intention", () => {
    const r = parseMenuDraft({ ...validDraft, serviceDate: toServiceDate("2026-06-01") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("still allows yesterday, so a missed entry can be recorded", () => {
    const r = parseMenuDraft({ ...validDraft, serviceDate: toServiceDate("2026-07-24") });
    expect(r.ok).toBe(true);
  });

  it("refuses a date absurdly far ahead", () => {
    const r = parseMenuDraft({ ...validDraft, serviceDate: toServiceDate("2027-07-25") });
    expect(r.ok).toBe(false);
  });
});

describe("resolveServiceState — what the student sees right now", () => {
  const at = (iso: string) =>
    resolveServiceState({ timeZone: TZ, now: new Date(iso), slots: SLOTS });

  it("reports lunch as being served during the lunch window", () => {
    // 07:00 UTC = 12:30 IST, inside 12:00–14:30.
    const state = at("2026-07-25T07:00:00Z");
    expect(state.serviceDate).toBe("2026-07-25");
    expect(state.current?.slot).toBe(MealSlot.LUNCH);
    expect(state.next?.slot).toBe(MealSlot.DINNER);
  });

  it("reports nothing current between meals, with dinner next", () => {
    // 11:00 UTC = 16:30 IST, after lunch and before dinner.
    const state = at("2026-07-25T11:00:00Z");
    expect(state.current).toBeUndefined();
    expect(state.next?.slot).toBe(MealSlot.DINNER);
  });

  it("reports lunch as next before the day's first service", () => {
    // 03:00 UTC = 08:30 IST.
    const state = at("2026-07-25T03:00:00Z");
    expect(state.current).toBeUndefined();
    expect(state.next?.slot).toBe(MealSlot.LUNCH);
    expect(state.next?.serviceDate).toBe("2026-07-25");
  });

  it("rolls to tomorrow's lunch once the last service has closed", () => {
    // 17:00 UTC = 22:30 IST, after dinner closes at 22:00.
    const state = at("2026-07-25T17:00:00Z");
    expect(state.current).toBeUndefined();
    expect(state.next?.slot).toBe(MealSlot.LUNCH);
    expect(state.next?.serviceDate).toBe("2026-07-26");
  });

  it("uses the tenant's day, not UTC's", () => {
    // 20:00 UTC on the 25th is 01:30 on the 26th in Kolkata. A UTC-derived
    // service date would show the 25th's menu to someone whose day has turned.
    const state = at("2026-07-25T20:00:00Z");
    expect(state.serviceDate).toBe("2026-07-26");
    expect(state.next?.serviceDate).toBe("2026-07-26");
  });

  it("orders slots by time of day regardless of configuration order", () => {
    const reversed = [SLOTS[1]!, SLOTS[0]!];
    const state = resolveServiceState({
      timeZone: TZ,
      now: new Date("2026-07-25T03:00:00Z"),
      slots: reversed,
    });
    expect(state.next?.slot).toBe(MealSlot.LUNCH);
  });

  it("handles a tenant serving a single meal", () => {
    const state = resolveServiceState({
      timeZone: TZ,
      now: new Date("2026-07-25T07:00:00Z"),
      slots: [SLOTS[0]!],
    });
    expect(state.current?.slot).toBe(MealSlot.LUNCH);
    expect(state.next?.serviceDate).toBe("2026-07-26");
  });

  it("returns no current and no next when the tenant serves nothing", () => {
    const state = resolveServiceState({ timeZone: TZ, now: new Date(), slots: [] });
    expect(state.current).toBeUndefined();
    expect(state.next).toBeUndefined();
  });

  it("treats a window ending before it starts as crossing midnight", () => {
    // Late dinner 22:00–00:30. At 23:00 IST that meal is being served.
    const late: MealSlotConfig[] = [
      { slot: MealSlot.DINNER, start: toWallClockTime("22:00"), end: toWallClockTime("00:30") },
    ];
    const state = resolveServiceState({
      timeZone: TZ,
      now: new Date("2026-07-25T17:30:00Z"), // 23:00 IST
      slots: late,
    });
    expect(state.current?.slot).toBe(MealSlot.DINNER);
  });
});
