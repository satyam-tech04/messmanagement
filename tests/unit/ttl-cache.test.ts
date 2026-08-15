/**
 * Tests for the short-lived per-tenant cache.
 *
 * Two of the seven database round trips behind every QR token — the tenant's
 * settings and its signing secret — are identical for every student in the
 * mess and change perhaps monthly. Re-reading them once per student per fifteen
 * seconds is the clearest waste in the system.
 *
 * The trade is staleness, and it is bounded deliberately rather than avoided:
 * a serverless deployment has many instances that cannot invalidate each
 * other's memory, so a TTL is the only honest mechanism. It is kept short
 * enough that a meal-window change made mid-service still takes effect within
 * seconds.
 *
 * The rule that matters most here is the last one: a failed lookup must never
 * be cached. Caching a null would keep the mess unable to issue codes for the
 * whole TTL after a momentary blip.
 */
import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "@/infra/cache/ttl-cache";

describe("createTtlCache", () => {
  it("calls through on a miss and returns the value", async () => {
    const load = vi.fn(async () => "settings");
    const cache = createTtlCache<string>(1000);
    expect(await cache.get("t1", load)).toBe("settings");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("serves the second call from memory without calling through", async () => {
    const load = vi.fn(async () => "settings");
    const cache = createTtlCache<string>(1000);
    await cache.get("t1", load);
    await cache.get("t1", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps tenants apart — one mess must never read another's settings", async () => {
    // The single most damaging way this could fail: a cache keyed loosely would
    // hand tenant B's signing secret to tenant A.
    const cache = createTtlCache<string>(1000);
    expect(await cache.get("t1", async () => "one")).toBe("one");
    expect(await cache.get("t2", async () => "two")).toBe("two");
    expect(await cache.get("t1", async () => "changed")).toBe("one");
  });

  it("calls through again once the entry has expired", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(async () => "settings");
      const cache = createTtlCache<string>(1000);
      await cache.get("t1", load);
      vi.advanceTimersByTime(1001);
      await cache.get("t1", load);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still serves an entry one tick before it expires", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(async () => "settings");
      const cache = createTtlCache<string>(1000);
      await cache.get("t1", load);
      vi.advanceTimersByTime(999);
      await cache.get("t1", load);
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never caches null — a blip must not blind the mess for the whole TTL", async () => {
    // Settings failing to load denies every QR code. Remembering that failure
    // would extend a one-request problem across everyone for the full window.
    const load = vi.fn(async () => null);
    const cache = createTtlCache<string>(1000);
    await cache.get("t1", load);
    await cache.get("t1", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not cache a thrown error either", async () => {
    const load = vi.fn(async () => {
      throw new Error("connection reset");
    });
    const cache = createTtlCache<string>(1000);
    await expect(cache.get("t1", load)).rejects.toThrow();
    await expect(cache.get("t1", load)).rejects.toThrow();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("can be cleared for one tenant, so a settings save takes effect at once", async () => {
    const load = vi.fn(async () => "settings");
    const cache = createTtlCache<string>(60_000);
    await cache.get("t1", load);
    cache.invalidate("t1");
    await cache.get("t1", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("invalidating one tenant leaves another's entry alone", async () => {
    const cache = createTtlCache<string>(60_000);
    await cache.get("t1", async () => "one");
    await cache.get("t2", async () => "two");
    cache.invalidate("t1");
    expect(await cache.get("t2", async () => "changed")).toBe("two");
  });

  it("does not grow without bound", async () => {
    // A cache on a long-lived server instance that never evicts is a leak. Only
    // a handful of tenants exist, but the bound must not depend on that.
    const cache = createTtlCache<string>(1000, 3);
    for (const id of ["a", "b", "c", "d", "e"]) {
      await cache.get(id, async () => id);
    }
    expect(cache.size()).toBeLessThanOrEqual(3);
  });
});
