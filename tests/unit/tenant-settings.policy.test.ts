/**
 * Tests for tenant settings validation.
 *
 * Meal windows are the highest-stakes setting in the product: they decide when
 * a scan is accepted. A malformed or overlapping window either rejects every
 * scan of that meal or silently lets students eat twice under two slots.
 */
import { describe, expect, it } from "vitest";
import { MealSlot, UserRole } from "@/core/domain/enums";
import {
  parseTenantSettings,
  type TenantSettingsInput,
} from "@/core/policies/tenant-settings.policy";

const valid: TenantSettingsInput = {
  actorRole: UserRole.ADMIN,
  mealSlots: [
    { slot: MealSlot.LUNCH, start: "12:00", end: "14:30" },
    { slot: MealSlot.DINNER, start: "19:30", end: "22:00" },
  ],
  qrTokenTtlSeconds: 30,
  qrRefreshSeconds: 15,
  slotsInUse: [],
};

describe("parseTenantSettings — authorization", () => {
  it("allows an admin", () => {
    expect(parseTenantSettings(valid).ok).toBe(true);
  });

  it("refuses staff — meal windows decide who gets fed", () => {
    const r = parseTenantSettings({ ...valid, actorRole: UserRole.STAFF });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("parseTenantSettings — meal windows", () => {
  it("accepts a normal window", () => {
    expect(parseTenantSettings(valid).ok).toBe(true);
  });

  it("rejects a malformed time", () => {
    const r = parseTenantSettings({
      ...valid,
      mealSlots: [{ slot: MealSlot.LUNCH, start: "12:00", end: "25:00" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-time string", () => {
    const r = parseTenantSettings({
      ...valid,
      mealSlots: [{ slot: MealSlot.LUNCH, start: "noon", end: "14:30" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an empty slot list — a mess that serves nothing cannot operate", () => {
    const r = parseTenantSettings({ ...valid, mealSlots: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects the same meal configured twice", () => {
    // Two lunch windows would make "which window applies?" unanswerable.
    const r = parseTenantSettings({
      ...valid,
      mealSlots: [
        { slot: MealSlot.LUNCH, start: "12:00", end: "13:00" },
        { slot: MealSlot.LUNCH, start: "13:30", end: "14:30" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CONFLICT");
  });

  it("rejects two meals whose windows overlap", () => {
    // A student could otherwise be served twice in the overlap, once under each
    // slot, and both scans would look legitimate.
    const r = parseTenantSettings({
      ...valid,
      mealSlots: [
        { slot: MealSlot.LUNCH, start: "12:00", end: "15:00" },
        { slot: MealSlot.DINNER, start: "14:00", end: "22:00" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CONFLICT");
  });

  it("allows windows that merely touch at the boundary", () => {
    // Windows are start-inclusive, end-exclusive, so 14:30 belongs to dinner
    // only. That is adjacency, not overlap.
    const r = parseTenantSettings({
      ...valid,
      mealSlots: [
        { slot: MealSlot.LUNCH, start: "12:00", end: "14:30" },
        { slot: MealSlot.DINNER, start: "14:30", end: "22:00" },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("allows a late window that crosses midnight", () => {
    // Hostels really do serve dinner 22:00–00:30.
    const r = parseTenantSettings({
      ...valid,
      mealSlots: [{ slot: MealSlot.DINNER, start: "22:00", end: "00:30" }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a zero-length window", () => {
    const r = parseTenantSettings({
      ...valid,
      mealSlots: [{ slot: MealSlot.LUNCH, start: "12:00", end: "12:00" }],
    });
    expect(r.ok).toBe(false);
  });

  it("orders the saved slots by time of day", () => {
    const r = parseTenantSettings({
      ...valid,
      mealSlots: [
        { slot: MealSlot.DINNER, start: "19:30", end: "22:00" },
        { slot: MealSlot.BREAKFAST, start: "07:30", end: "09:30" },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.mealSlots.map((s) => s.slot)).toEqual(["BREAKFAST", "DINNER"]);
  });
});

describe("parseTenantSettings — a meal in use cannot be dropped", () => {
  it("refuses to stop serving a meal that active plans still include", () => {
    // Otherwise the students on that plan are silently left holding a promise
    // the mess no longer honours, and their per-meal rate becomes wrong.
    const r = parseTenantSettings({
      ...valid,
      mealSlots: [{ slot: MealSlot.LUNCH, start: "12:00", end: "14:30" }],
      slotsInUse: [MealSlot.LUNCH, MealSlot.DINNER],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CONFLICT");
  });

  it("names the meal being dropped, so the admin knows which plans to change", () => {
    const r = parseTenantSettings({
      ...valid,
      mealSlots: [{ slot: MealSlot.LUNCH, start: "12:00", end: "14:30" }],
      slotsInUse: [MealSlot.DINNER],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message.toLowerCase()).toContain("dinner");
  });

  it("allows dropping a meal nothing depends on", () => {
    const r = parseTenantSettings({
      ...valid,
      mealSlots: [{ slot: MealSlot.LUNCH, start: "12:00", end: "14:30" }],
      slotsInUse: [MealSlot.LUNCH],
    });
    expect(r.ok).toBe(true);
  });

  it("allows adding a meal freely — nothing depends on a slot that did not exist", () => {
    const r = parseTenantSettings({
      ...valid,
      mealSlots: [
        { slot: MealSlot.BREAKFAST, start: "07:30", end: "09:30" },
        { slot: MealSlot.LUNCH, start: "12:00", end: "14:30" },
        { slot: MealSlot.DINNER, start: "19:30", end: "22:00" },
      ],
      slotsInUse: [MealSlot.LUNCH, MealSlot.DINNER],
    });
    expect(r.ok).toBe(true);
  });

  it("allows changing the times of a meal that is in use", () => {
    const r = parseTenantSettings({
      ...valid,
      mealSlots: [
        { slot: MealSlot.LUNCH, start: "11:00", end: "14:00" },
        { slot: MealSlot.DINNER, start: "19:30", end: "22:00" },
      ],
      slotsInUse: [MealSlot.LUNCH, MealSlot.DINNER],
    });
    expect(r.ok).toBe(true);
  });
});

describe("parseTenantSettings — the rule must not deadlock the screen", () => {
  it("adding a meal is never blocked by an unrelated slot still in use", () => {
    // Found by probing live data: keying on frozen subscription snapshots meant
    // a legacy subscription mentioning snacks made it impossible to ever add
    // breakfast, because snacks would never stop being 'in use'. `slotsInUse`
    // is therefore active plans only — those the admin can actually edit.
    const r = parseTenantSettings({
      ...valid,
      mealSlots: [
        { slot: MealSlot.BREAKFAST, start: "07:30", end: "09:30" },
        { slot: MealSlot.LUNCH, start: "12:00", end: "14:30" },
        { slot: MealSlot.DINNER, start: "19:30", end: "22:00" },
      ],
      slotsInUse: [MealSlot.LUNCH, MealSlot.DINNER],
    });
    expect(r.ok).toBe(true);
  });

  it("leaves a path out: once the plan drops the meal, the setting can change", () => {
    // Step 1 — plan still offers dinner, so dropping dinner is refused.
    const blocked = parseTenantSettings({
      ...valid,
      mealSlots: [{ slot: MealSlot.LUNCH, start: "12:00", end: "14:30" }],
      slotsInUse: [MealSlot.LUNCH, MealSlot.DINNER],
    });
    expect(blocked.ok).toBe(false);

    // Step 2 — admin edits the plan to lunch only; now it is allowed.
    const allowed = parseTenantSettings({
      ...valid,
      mealSlots: [{ slot: MealSlot.LUNCH, start: "12:00", end: "14:30" }],
      slotsInUse: [MealSlot.LUNCH],
    });
    expect(allowed.ok).toBe(true);
  });
});

describe("parseTenantSettings — QR rotation", () => {
  it("rejects a refresh interval at or above the token TTL", () => {
    // The student would be holding an already-dead code between redraws and be
    // refused at the counter through no fault of their own.
    const r = parseTenantSettings({ ...valid, qrTokenTtlSeconds: 30, qrRefreshSeconds: 30 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a refresh longer than the TTL", () => {
    expect(parseTenantSettings({ ...valid, qrTokenTtlSeconds: 30, qrRefreshSeconds: 45 }).ok).toBe(
      false,
    );
  });

  it("rejects a TTL outside the range the database allows", () => {
    // The column CHECK is 10–300; failing here gives a readable message instead
    // of a raw constraint violation.
    expect(parseTenantSettings({ ...valid, qrTokenTtlSeconds: 5 }).ok).toBe(false);
    expect(parseTenantSettings({ ...valid, qrTokenTtlSeconds: 301 }).ok).toBe(false);
  });

  it("rejects a non-positive refresh interval", () => {
    expect(parseTenantSettings({ ...valid, qrRefreshSeconds: 0 }).ok).toBe(false);
  });

  it("accepts the boundary values", () => {
    expect(parseTenantSettings({ ...valid, qrTokenTtlSeconds: 10, qrRefreshSeconds: 9 }).ok).toBe(
      true,
    );
    expect(
      parseTenantSettings({ ...valid, qrTokenTtlSeconds: 300, qrRefreshSeconds: 299 }).ok,
    ).toBe(true);
  });
});
