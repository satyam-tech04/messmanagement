/**
 * Append-only audit trail (§4.4).
 *
 * Writes go through the SERVICE ROLE deliberately. `audit_log` has a read
 * policy for admins and no insert policy at all, so an actor cannot forge an
 * entry attributing an action to someone else — nor suppress their own. The
 * trail is only worth having if the people it records cannot edit it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditLogRepository } from "@/core/ports/repositories";
import type { Database } from "../database.types";
import type { Json } from "../database.types";

export class SupabaseAuditLogRepository implements AuditLogRepository {
  /** Must be a service-role client; the anon client has no insert policy here. */
  constructor(private readonly admin: SupabaseClient<Database>) {}

  async write(entry: {
    tenantId: string;
    actorProfileId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    const { error } = await this.admin.from("audit_log").insert({
      tenant_id: entry.tenantId,
      actor_profile_id: entry.actorProfileId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      before: (entry.before ?? null) as Json,
      after: (entry.after ?? null) as Json,
      ip: entry.ip ?? null,
      user_agent: entry.userAgent ?? null,
    });

    if (error) {
      // Deliberately loud. A manual attendance override whose audit entry
      // vanished is exactly the record someone will ask for during a dispute,
      // so the caller must not be allowed to believe it was written.
      throw new Error(`audit log write failed: ${error.message}`);
    }
  }
}
