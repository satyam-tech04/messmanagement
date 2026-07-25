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

export class SupabaseTenantRepository implements TenantRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    /** Service-role client. Required only for the signing secret. */
    private readonly admin: SupabaseClient<Database>,
  ) {}

  async getSettings(tenantId: string): Promise<TenantSettings | null> {
    const { data, error } = await this.db
      .from("tenant_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new Error(`tenant_settings read failed: ${error.message}`);
    return data ? toTenantSettings(data) : null;
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
    const { data, error } = await this.admin
      .from("tenant_secrets")
      .select("qr_signing_secret")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new Error(`tenant signing secret read failed: ${error.message}`);
    return data?.qr_signing_secret ?? null;
  }
}
