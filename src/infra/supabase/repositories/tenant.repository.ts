/**
 * Tenant settings, timezone and signing secret.
 *
 * Takes two clients on purpose. Settings and timezone are readable by any
 * member of the tenant, so they go through the caller's session client and stay
 * under RLS. The QR signing secret does not: `tenant_secrets` is RLS-enabled
 * with zero policies, so only the service role can read it (§5.3). An admin who
 * could read their own signing secret could mint attendance for any student.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantSettings } from "@/core/domain/tenant-context";
import type { TenantRepository } from "@/core/ports/repositories";
import type { Database } from "../database.types";
import { toTenantSettings } from "../mappers";
import { createTtlCache } from "@/infra/cache/ttl-cache";

/**
 * Both of these are read on **every QR token request** — a few hundred students
 * refreshing every fifteen seconds — and both are identical for everyone in the
 * mess and change perhaps monthly. Caching them removes two of the seven
 * database round trips behind each token.
 *
 * Thirty seconds is the bound on staleness. It is short enough that an admin
 * widening a meal window mid-service sees it take effect while they are still
 * looking at the screen, and long enough to absorb an entire meal rush. The
 * settings screen says so rather than promising an immediacy that is not true.
 *
 * Module-level, so it is shared by every request an instance handles. RLS is
 * NOT bypassed by this: settings are readable by any member of the tenant
 * anyway, and the cache is keyed by tenant id so one mess can never be served
 * another's. The tests assert that specifically.
 */
const TENANT_CACHE_TTL_MS = 30_000;

const settingsCache = createTtlCache<TenantSettings>(TENANT_CACHE_TTL_MS);
const secretCache = createTtlCache<string>(TENANT_CACHE_TTL_MS);

/**
 * What the app shell needs to draw itself: the mess's name and the two toggles
 * that decide which nav links exist.
 *
 * Cached for the same reason and with the same bound. This runs in the shared
 * layout, so it was two database queries on **every page load in the entire
 * app** — before the page had done any work of its own — for a name that never
 * changes and two booleans that change perhaps twice a year.
 */
export interface TenantChrome {
  readonly name: string;
  readonly allowMealSkipping: boolean;
  readonly allowAwayRequests: boolean;
}

const chromeCache = createTtlCache<TenantChrome>(TENANT_CACHE_TTL_MS);

/**
 * Drops this instance's cached copies for one tenant.
 *
 * Called after a settings save so the admin's own next page load is fresh.
 * Other serverless instances keep theirs until the TTL expires — there is no
 * way to reach them, which is exactly why the TTL is short.
 */
export function invalidateTenantCache(tenantId: string): void {
  settingsCache.invalidate(tenantId);
  secretCache.invalidate(tenantId);
  chromeCache.invalidate(tenantId);
}

export class SupabaseTenantRepository implements TenantRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    /** Service-role client. Required only for the signing secret. */
    private readonly admin: SupabaseClient<Database>,
  ) {}

  async getSettings(tenantId: string): Promise<TenantSettings | null> {
    return settingsCache.get(tenantId, async () => {
      const { data, error } = await this.db
        .from("tenant_settings")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      // Thrown, not cached. Settings failing to load denies every QR code in
      // the mess, and remembering that would extend one bad request into a
      // blind window for everyone.
      if (error) throw new Error(`tenant_settings read failed: ${error.message}`);
      return data ? toTenantSettings(data) : null;
    });
  }

  /**
   * One cached read for the whole app shell, replacing two uncached ones.
   *
   * Deliberately its own query rather than reusing `getSettings`: that returns
   * the full settings row including meal windows, and the layout needs two
   * booleans and a name. Caching a narrow row is cheaper to hold and cannot
   * accidentally become the thing the QR path depends on.
   */
  async getChrome(tenantId: string): Promise<TenantChrome | null> {
    return chromeCache.get(tenantId, async () => {
      const [{ data: tenant }, { data: settings }] = await Promise.all([
        this.db.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
        this.db
          .from("tenant_settings")
          .select("allow_meal_skipping, allow_away_requests")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
      ]);

      if (!tenant) return null;
      return {
        name: tenant.name,
        // Fail closed: a student sees no way to skip a meal unless the mess has
        // definitely turned it on.
        allowMealSkipping: settings?.allow_meal_skipping ?? false,
        allowAwayRequests: settings?.allow_away_requests ?? false,
      };
    });
  }

  async getTimezone(tenantId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("tenants")
      .select("timezone")
      .eq("id", tenantId)
      .maybeSingle();

    if (error) throw new Error(`tenant timezone read failed: ${error.message}`);
    return data?.timezone ?? null;
  }

  async getQrSigningSecret(tenantId: string): Promise<string | null> {
    return secretCache.get(tenantId, async () => {
      const { data, error } = await this.admin
        .from("tenant_secrets")
        .select("qr_signing_secret")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) throw new Error(`tenant signing secret read failed: ${error.message}`);
      return data?.qr_signing_secret ?? null;
    });
  }
}
