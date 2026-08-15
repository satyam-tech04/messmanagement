/**
 * The offline queue holds scans for students who have already walked away with
 * their food. Losing one means a meal was served and never recorded.
 *
 * The original implementation discarded anything older than six hours with no
 * trace, on the reasoning that replaying it would write the wrong service date.
 * The reasoning is right; discarding silently is not. A tablet left offline
 * overnight would quietly erase a whole service.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueScan,
  queuedScans,
  expiredScans,
  dequeueScan,
  clearExpiredScans,
  MAX_QUEUE_AGE_MS,
} from "@/app/(app)/staff/scan-queue";

/** Minimal localStorage, since these run outside a browser. */
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, v);
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
}

beforeEach(() => {
  const storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

describe("the queue keeps what it is given", () => {
  it("returns a scan that was just buffered", () => {
    enqueueScan({ mode: "QR", token: "t1" });
    expect(queuedScans()).toHaveLength(1);
  });

  it("gives each entry an id so a retry is recognisable", () => {
    const a = enqueueScan({ mode: "QR", token: "t1" });
    const b = enqueueScan({ mode: "QR", token: "t2" });
    expect(a.id).not.toBe(b.id);
  });

  it("removes an entry once the server has answered", () => {
    const entry = enqueueScan({ mode: "QR", token: "t1" });
    dequeueScan(entry.id);
    expect(queuedScans()).toHaveLength(0);
  });
});

describe("stale scans are surfaced, never silently dropped", () => {
  function buffer(ageMs: number) {
    const entry = enqueueScan({ mode: "QR", token: "old" });
    const raw = JSON.parse(window.localStorage.getItem("messos.scanQueue.v1")!);
    raw[raw.length - 1].queuedAt = Date.now() - ageMs;
    window.localStorage.setItem("messos.scanQueue.v1", JSON.stringify(raw));
    return entry;
  }

  it("stops offering a stale scan for sync — the service date would be wrong", () => {
    buffer(MAX_QUEUE_AGE_MS + 60_000);
    expect(queuedScans()).toHaveLength(0);
  });

  it("but KEEPS it, so staff can be told a meal went unrecorded", () => {
    // The whole point. Previously this entry was erased and nobody ever knew.
    buffer(MAX_QUEUE_AGE_MS + 60_000);
    expect(expiredScans()).toHaveLength(1);
  });

  it("does not treat a fresh scan as stale", () => {
    buffer(60_000);
    expect(queuedScans()).toHaveLength(1);
    expect(expiredScans()).toHaveLength(0);
  });

  it("keeps the two lists disjoint", () => {
    buffer(MAX_QUEUE_AGE_MS + 60_000);
    enqueueScan({ mode: "QR", token: "fresh" });
    expect(queuedScans()).toHaveLength(1);
    expect(expiredScans()).toHaveLength(1);
  });

  it("only forgets a stale scan when someone explicitly acknowledges it", () => {
    buffer(MAX_QUEUE_AGE_MS + 60_000);
    expect(expiredScans()).toHaveLength(1);
    clearExpiredScans();
    expect(expiredScans()).toHaveLength(0);
  });

  it("acknowledging stale entries leaves pending ones alone", () => {
    buffer(MAX_QUEUE_AGE_MS + 60_000);
    enqueueScan({ mode: "QR", token: "fresh" });
    clearExpiredScans();
    expect(queuedScans()).toHaveLength(1);
  });
});

describe("corrupt storage cannot break the counter mid-service", () => {
  it("treats unreadable storage as an empty queue", () => {
    window.localStorage.setItem("messos.scanQueue.v1", "{not json");
    expect(queuedScans()).toEqual([]);
    expect(expiredScans()).toEqual([]);
  });

  it("still accepts new scans afterwards", () => {
    window.localStorage.setItem("messos.scanQueue.v1", "{not json");
    enqueueScan({ mode: "QR", token: "t1" });
    expect(queuedScans()).toHaveLength(1);
  });
});
