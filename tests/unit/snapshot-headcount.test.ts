/**
 * Tests for the headcount snapshot job (§9).
 *
 * "All jobs must be idempotent and re-runnable — cron will fire twice one day."
 * The locking rule carries the real weight: once a count is locked the kitchen
 * has bought ingredients against it, so a later re-run must not silently move
 * the number they cooked to.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { snapshotHeadcount, type SnapshotHeadcountDeps } from "@/core/services/snapshot-headcount";
import type { TenantSettings } from "@/core/domain/tenant-context";
import type { SubscriberSnapshot } from "@/core/policies/headcount.policy";
import { toServiceDate, toWallClockTime } from "@/core/time";
import { isErr, isOk, unwrap } from "@/core/result";
import {
  FakeHeadcountSnapshotRepository,
  FakeMessCutRepository,
  FakeSubscriptionRepository,
  FakeTenantRepository,
} from "../fakes";

const IST = "Asia/Kolkata";
const TENANT = "11111111-1111-1111-1111-111111111111";
const DATE = toServiceDate("2026-07-15");

const settings: TenantSettings = {
  tenantId: TENANT,
  mealSlots: [
    { slot: "LUNCH", start: toWallClockTime("12:00"), end: toWallClockTime("14:30") },
    { slot: "DINNER", start: toWallClockTime("19:30"), end: toWallClockTime("22:00") },
  ],
  cutAdvanceHours: 12,
  cutMaxDaysPerMonth: 5,
  gracePeriodDays: 3,
  blockOnOverdue: true,
  allowExtras: false,
  guestTokenPricePaise: 0,
  extraPlatePricePaise: 0,
  qrTokenTtlSeconds: 30,
  qrRefreshSeconds: 15,
  currency: "INR",
};

function subscriber(id: string, over: Partial<SubscriberSnapshot> = {}): SubscriberSnapshot {
  return {
    studentId: id,
    studentStatus: "ACTIVE",
    subscriptionStatus: "ACTIVE",
    startDate: toServiceDate("2026-07-01"),
    endDate: toServiceDate("2026-07-31"),
    includedMealSlots: ["LUNCH", "DINNER"],
    ...over,
  };
}

let snapshots: FakeHeadcountSnapshotRepository;
let subscriptions: FakeSubscriptionRepository;
let messCuts: FakeMessCutRepository;

function deps(): SnapshotHeadcountDeps {
  const tenants = new FakeTenantRepository();
  tenants.set(TENANT, settings, IST, "secret");
  return {
    tenants,
    subscriptions,
    messCuts,
    snapshots,
    now: () => new Date("2026-07-15T02:00:00Z"),
  };
}

beforeEach(() => {
  snapshots = new FakeHeadcountSnapshotRepository();
  subscriptions = new FakeSubscriptionRepository([
    subscriber("s1"),
    subscriber("s2"),
    subscriber("s3"),
  ]);
  messCuts = new FakeMessCutRepository([]);
});

describe("snapshotHeadcount", () => {
  it("writes one snapshot per served meal slot", async () => {
    const result = await snapshotHeadcount(TENANT, DATE, deps());
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(unwrap(result).written).toHaveLength(2);
    expect(snapshots.rows).toHaveLength(2);
  });

  it("counts the eligible subscribers", async () => {
    const result = await snapshotHeadcount(TENANT, DATE, deps());
    if (isOk(result)) {
      const lunch = unwrap(result).written.find((w) => w.mealSlot === "LUNCH");
      expect(lunch?.projectedCount).toBe(3);
    }
  });

  it("excludes a blocked student — cooking for them wastes food", async () => {
    subscriptions = new FakeSubscriptionRepository([
      subscriber("s1"),
      subscriber("s2", { studentStatus: "BLOCKED" }),
      subscriber("s3"),
    ]);
    const result = await snapshotHeadcount(TENANT, DATE, deps());
    if (isOk(result)) {
      expect(unwrap(result).written.find((w) => w.mealSlot === "LUNCH")?.projectedCount).toBe(2);
    }
  });

  it("still counts a student in GRACE — they will be served", async () => {
    subscriptions = new FakeSubscriptionRepository([
      subscriber("s1", { studentStatus: "GRACE" }),
      subscriber("s2"),
      subscriber("s3"),
    ]);
    const result = await snapshotHeadcount(TENANT, DATE, deps());
    if (isOk(result)) {
      expect(unwrap(result).written.find((w) => w.mealSlot === "LUNCH")?.projectedCount).toBe(3);
    }
  });

  it("subtracts an approved mess cut", async () => {
    messCuts = new FakeMessCutRepository([
      {
        studentId: "s2",
        dateFrom: DATE,
        dateTo: DATE,
        mealSlots: ["LUNCH"],
        status: "APPROVED",
      },
    ]);
    const result = await snapshotHeadcount(TENANT, DATE, deps());
    if (isOk(result)) {
      const w = unwrap(result).written;
      expect(w.find((x) => x.mealSlot === "LUNCH")?.projectedCount).toBe(2);
      // The cut was lunch-only, so dinner is untouched.
      expect(w.find((x) => x.mealSlot === "DINNER")?.projectedCount).toBe(3);
    }
  });
});

describe("snapshotHeadcount — idempotency (cron fires twice)", () => {
  it("running twice leaves one snapshot per slot, not four", async () => {
    await snapshotHeadcount(TENANT, DATE, deps());
    await snapshotHeadcount(TENANT, DATE, deps());
    expect(snapshots.rows).toHaveLength(2);
  });

  it("re-running before the lock refreshes the number", async () => {
    await snapshotHeadcount(TENANT, DATE, deps());
    expect(snapshots.rowFor(DATE, "LUNCH")?.projectedCount).toBe(3);

    // A student joined after the first run. The kitchen has not committed yet,
    // so the newer, more accurate figure should win.
    subscriptions = new FakeSubscriptionRepository([
      subscriber("s1"),
      subscriber("s2"),
      subscriber("s3"),
      subscriber("s4"),
    ]);
    await snapshotHeadcount(TENANT, DATE, deps());
    expect(snapshots.rowFor(DATE, "LUNCH")?.projectedCount).toBe(4);
  });
});

describe("snapshotHeadcount — locking", () => {
  it("marks the snapshot locked when asked", async () => {
    await snapshotHeadcount(TENANT, DATE, deps(), { lock: true });
    expect(snapshots.rowFor(DATE, "LUNCH")?.lockedAt).not.toBeNull();
  });

  it("leaves it unlocked by default", async () => {
    await snapshotHeadcount(TENANT, DATE, deps());
    expect(snapshots.rowFor(DATE, "LUNCH")?.lockedAt).toBeNull();
  });

  it("NEVER changes a locked count — the kitchen has already bought for it", async () => {
    await snapshotHeadcount(TENANT, DATE, deps(), { lock: true });

    subscriptions = new FakeSubscriptionRepository([
      subscriber("s1"),
      subscriber("s2"),
      subscriber("s3"),
      subscriber("s4"),
      subscriber("s5"),
    ]);
    const result = await snapshotHeadcount(TENANT, DATE, deps(), { lock: true });

    expect(snapshots.rowFor(DATE, "LUNCH")?.projectedCount).toBe(3);
    if (isOk(result)) expect(unwrap(result).skipped).toBe(2);
  });

  it("reports a locked slot as skipped rather than failing the whole run", async () => {
    // A partially locked day must not abort: the other meal still needs a count.
    await snapshotHeadcount(TENANT, DATE, deps(), { lock: true, slots: ["LUNCH"] });
    const result = await snapshotHeadcount(TENANT, DATE, deps(), { lock: true });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(unwrap(result).skipped).toBe(1);
      expect(unwrap(result).written).toHaveLength(1);
      expect(unwrap(result).written[0]?.mealSlot).toBe("DINNER");
    }
  });
});

describe("snapshotHeadcount — failure modes", () => {
  it("fails closed when tenant settings cannot be read", async () => {
    const broken = { ...deps(), tenants: new FakeTenantRepository() };
    const result = await snapshotHeadcount(TENANT, DATE, broken);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INFRASTRUCTURE_ERROR");
    expect(snapshots.rows).toHaveLength(0);
  });

  it("writes a zero count rather than nothing when a mess has no subscribers", async () => {
    // A missing row is indistinguishable from "job never ran"; an explicit zero
    // tells the kitchen the answer is genuinely none.
    subscriptions = new FakeSubscriptionRepository([]);
    const result = await snapshotHeadcount(TENANT, DATE, deps());
    expect(isOk(result)).toBe(true);
    expect(snapshots.rows).toHaveLength(2);
    expect(snapshots.rowFor(DATE, "LUNCH")?.projectedCount).toBe(0);
  });
});
