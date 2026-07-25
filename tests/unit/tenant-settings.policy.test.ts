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
