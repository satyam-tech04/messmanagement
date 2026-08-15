/**
 * Postgres-backed fixed-window rate limiter (§12).
 *
 * "rate-limit /api/qr/token (per student) and /api/qr/verify (per device)."
 *
 * Deliberately in the database rather than in process memory: this app runs on
 * serverless instances that do not share memory, so an in-memory limiter would
 * reset on every cold start and differ per instance. That is security theatre —
 * it looks like a control and stops nothing.
 *
 * Requires the service-role client; the wrapper function is granted to
 * `service_role` only, so a client cannot reset its own bucket or exhaust
 * someone else's.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimiter } from "@/core/ports/repositories";
import type { Database } from "../database.types";

export class SupabaseRateLimiter implements RateLimiter {
  constructor(private readonly admin: SupabaseClient<Database>) {}

  async consume(bucketKey: string, windowSeconds: number, maxRequests: number): Promise<boolean> {
    const { data, error } = await this.admin.rpc("consume_rate_limit", {
      p_bucket_key: bucketKey,
      p_window_seconds: windowSeconds,
      p_max_requests: maxRequests,
    });

    if (error) {
      // Fail OPEN, uniquely in this system.
      //
      // Everywhere else we fail closed (§2.7), but a rate limiter is a
      // availability control, not an authorization one. If the limiter itself
      // is broken, denying every scan would turn a minor infrastructure blip
      // into a mess that cannot serve dinner. The real authorization checks —
      // signature, TTL, subscription, the uniqueness constraint — all still
      // run and all still fail closed.
      console.error(`rate limiter unavailable, allowing request: ${error.message}`);
      return true;
    }

    return data === true;
  }
}

/** Bucket key helpers, so the same student is never counted under two keys. */
export const rateLimitBuckets = {
  qrToken: (tenantId: string, studentId: string) => `qr-token:${tenantId}:${studentId}`,
  /**
   * Keyed by the signed-in staff profile, never by a client-supplied device id.
   * A caller who can choose the key can defeat the limit by varying it.
   */
  qrVerify: (tenantId: string, staffProfileId: string) => `qr-verify:${tenantId}:${staffProfileId}`,
  login: (identifier: string) => `login:${identifier.toLowerCase()}`,
} as const;
