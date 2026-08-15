/**
 * A small, short-lived, per-tenant cache.
 *
 * Exists for one measured problem: every QR token costs seven database round
 * trips, and two of them — the tenant's settings and its signing secret — are
 * **identical for every student in the mess** and change perhaps monthly. At a
 * few hundred students refreshing every fifteen seconds, that is thousands of
 * reads a minute for two values that never move.
 *
 * Deliberately in process memory rather than in Postgres or Redis: the point is
 * to avoid a network round trip, and anything shared would reintroduce one.
 * The cost is that serverless instances cannot invalidate each other, so a TTL
 * is the only honest bound on staleness — `invalidate` helps the instance that
 * handled the write and nothing else.
 *
 * Two rules that matter more than the caching:
 *
 *   - **Never cache a failure.** Settings failing to load denies every QR code
 *     in the mess; remembering that would turn one bad request into a blind
 *     window for everyone.
 *   - **Never share across tenants.** Keyed by tenant id, and the tests assert
 *     one mess can never be handed another's signing secret.
 */

interface Entry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

export interface TtlCache<T> {
  get(key: string, load: () => Promise<T | null>): Promise<T | null>;
  invalidate(key: string): void;
  size(): number;
}

/**
 * @param ttlMs how long a value may be served before it is re-read
 * @param maxEntries a hard bound, so a long-lived instance cannot leak. Only a
 * handful of tenants exist, but the bound must not depend on that staying true.
 */
export function createTtlCache<T>(ttlMs: number, maxEntries = 100): TtlCache<T> {
  const entries = new Map<string, Entry<T>>();

  return {
    async get(key, load) {
      const hit = entries.get(key);
      if (hit && hit.expiresAt > Date.now()) return hit.value;

      // Errors propagate and are not remembered — see the note above.
      const value = await load();
      if (value === null || value === undefined) {
        entries.delete(key);
        return value ?? null;
      }

      // Oldest-first eviction. Map preserves insertion order, so the first key
      // is the least recently *stored*, which is close enough for a cache whose
      // real bound is the TTL.
      if (!entries.has(key) && entries.size >= maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }

      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    },

    invalidate(key) {
      entries.delete(key);
    },

    size() {
      return entries.size;
    },
  };
}
