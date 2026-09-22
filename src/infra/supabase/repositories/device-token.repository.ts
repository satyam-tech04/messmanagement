/**
 * Device tokens and notification deliveries, against Supabase (D-34).
 *
 * Service-role: registering a token writes the tenant it belongs to, which must
 * be derived server-side and never accepted from the app (rule 8), and the
 * delivery ledger has no policies at all because no student screen reads it.
 * Every query still filters by `tenant_id`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationKind } from "@/core/policies/notification.policy";
import type {
  DeviceTokenRepository,
  NotificationDeliveryRepository,
  NotificationRecipient,
  RegisterDeviceInput,
} from "@/core/ports/repositories";
import type { Database } from "../database.types";
import { firstRelated } from "../mappers";

type Client = SupabaseClient<Database>;

type ProfileRow = {
  id: string;
  notification_opt_outs: string[] | null;
  students: unknown;
  device_tokens: unknown;
};

function toRecipient(row: ProfileRow): NotificationRecipient {
  const student = firstRelated<{ status: NotificationRecipient["studentStatus"] }>(
    row.students as never,
  );
  const tokens = Array.isArray(row.device_tokens)
    ? (row.device_tokens as Array<{ token: string }>).map((d) => d.token)
    : [];

  return {
    profileId: row.id,
    // No student row means no student. Fails closed: the policy refuses
    // INACTIVE, so an employee's profile can never be swept into a fan-out.
    studentStatus: student?.status ?? "INACTIVE",
    optOuts: row.notification_opt_outs ?? [],
    tokens,
  };
}

const RECIPIENT_SELECT = `
  id, notification_opt_outs,
  students!inner ( status ),
  device_tokens ( token )
` as const;

export class SupabaseDeviceTokenRepository implements DeviceTokenRepository {
  constructor(private readonly client: Client) {}

  async register(input: RegisterDeviceInput): Promise<void> {
    // Conflict on the token, not on the profile. FCM reissues tokens and hands
    // a reinstalled app one another install used to hold, so the token is the
    // identity — upserting on it is what moves a device between accounts
    // instead of leaving the previous student receiving its notifications.
    const { error } = await this.client.from("device_tokens").upsert(
      {
        tenant_id: input.tenantId,
        profile_id: input.profileId,
        token: input.token,
        platform: input.platform,
        app_build: input.appBuild,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );

    if (error) throw error;
  }

  async forget(token: string): Promise<void> {
    // Not scoped by tenant: a token is globally unique, and this is called on
    // sign-out, when the caller is giving up a device they hold.
    await this.client.from("device_tokens").delete().eq("token", token);
  }

  async forgetAllFor(tenantId: string, profileId: string): Promise<void> {
    await this.client
      .from("device_tokens")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("profile_id", profileId);
  }

  async prune(tokens: readonly string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.client
      .from("device_tokens")
      .delete()
      .in("token", [...tokens]);
  }

  async studentsOf(tenantId: string): Promise<readonly NotificationRecipient[]> {
    const { data, error } = await this.client
      .from("profiles")
      .select(RECIPIENT_SELECT)
      .eq("tenant_id", tenantId)
      .eq("role", "STUDENT");

    if (error || !data) return [];
    return (data as unknown as ProfileRow[]).map(toRecipient);
  }

  async byProfileIds(
    tenantId: string,
    profileIds: readonly string[],
  ): Promise<readonly NotificationRecipient[]> {
    if (profileIds.length === 0) return [];

    const { data, error } = await this.client
      .from("profiles")
      .select(RECIPIENT_SELECT)
      .eq("tenant_id", tenantId)
      .in("id", [...profileIds]);

    if (error || !data) return [];
    return (data as unknown as ProfileRow[]).map(toRecipient);
  }

  async optOutsFor(tenantId: string, profileId: string): Promise<readonly string[]> {
    const { data } = await this.client
      .from("profiles")
      .select("notification_opt_outs")
      .eq("tenant_id", tenantId)
      .eq("id", profileId)
      .maybeSingle();

    return data?.notification_opt_outs ?? [];
  }

  async setOptOuts(tenantId: string, profileId: string, kinds: readonly string[]): Promise<void> {
    const { error } = await this.client
      .from("profiles")
      .update({ notification_opt_outs: [...kinds] })
      .eq("tenant_id", tenantId)
      .eq("id", profileId);

    if (error) throw error;
  }
}

export class SupabaseNotificationDeliveryRepository implements NotificationDeliveryRepository {
  constructor(private readonly client: Client) {}

  async claim(tenantId: string, kind: NotificationKind, dedupeKey: string): Promise<boolean> {
    // The insert IS the claim. Two servers racing on the same cron tick both
    // reach here; the unique index picks one and the other sends nothing.
    const { data, error } = await this.client
      .from("notification_deliveries")
      .insert({ tenant_id: tenantId, kind, dedupe_key: dedupeKey })
      .select("id")
      .maybeSingle();

    if (error) {
      // 23505 — somebody else already sent this. Any other error means we do
      // not know, and not sending is the safe answer for a notification.
      return false;
    }

    return Boolean(data);
  }

  async record(
    tenantId: string,
    kind: NotificationKind,
    dedupeKey: string,
    counts: { readonly sent: number; readonly failed: number },
  ): Promise<void> {
    await this.client
      .from("notification_deliveries")
      .update({ sent_count: counts.sent, failed_count: counts.failed })
      .eq("tenant_id", tenantId)
      .eq("kind", kind)
      .eq("dedupe_key", dedupeKey);
  }
}
