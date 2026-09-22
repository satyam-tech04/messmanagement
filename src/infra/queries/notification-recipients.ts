/**
 * Who an admin can send a notification to, and who will actually receive it.
 *
 * The second half matters more than the first. A student with no device
 * registered — never installed the app, or signed out — cannot be reached, and
 * an admin who types a message for 300 students deserves to know it is going to
 * 240 before they send it, not afterwards.
 *
 * Read with the service role because device tokens are deliberately not
 * readable under RLS by anyone but their owner. Only counts leave this file;
 * the tokens themselves never reach a screen.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudentStatus } from "@/core/domain/enums";
import { NotificationKind } from "@/core/policies/notification.policy";
import type { Database } from "@/infra/supabase/database.types";
import { firstRelated } from "@/infra/supabase/mappers";

export interface NotificationRecipientRow {
  readonly profileId: string;
  readonly fullName: string;
  readonly rollNumber: string;
  readonly status: StudentStatus;
  /** How many phones this student has the app signed in on. */
  readonly deviceCount: number;
  /** They have switched announcements off; a manual send will skip them. */
  readonly muted: boolean;
}

export interface NotificationAudience {
  readonly rows: readonly NotificationRecipientRow[];
  /** Students who would actually be reached by a send to everyone. */
  readonly reachable: number;
}

export async function readNotificationAudience(
  admin: SupabaseClient<Database>,
  tenantId: string,
): Promise<NotificationAudience> {
  const { data, error } = await admin
    .from("students")
    .select(
      `profile_id, roll_number, status,
       profiles!inner ( full_name, notification_opt_outs, device_tokens ( token ) )`,
    )
    .eq("tenant_id", tenantId)
    // A student who has left keeps their row for the mess's records but is
    // never notified (see the policy), so they are not offered as a recipient.
    .neq("status", "INACTIVE")
    .order("roll_number");

  if (error || !data) return { rows: [], reachable: 0 };

  const rows = data.map((row) => {
    const profile = firstRelated<{
      full_name: string;
      notification_opt_outs: string[] | null;
      device_tokens: unknown;
    }>(row.profiles as never);

    const devices = Array.isArray(profile?.device_tokens) ? profile.device_tokens.length : 0;

    return {
      profileId: row.profile_id,
      fullName: profile?.full_name ?? "Unknown",
      rollNumber: row.roll_number,
      status: row.status,
      deviceCount: devices,
      muted: (profile?.notification_opt_outs ?? []).includes(NotificationKind.ANNOUNCEMENT),
    };
  });

  return {
    rows,
    reachable: rows.filter((r) => r.deviceCount > 0 && !r.muted).length,
  };
}

export interface SentNotificationRow {
  readonly id: string;
  readonly kind: string;
  readonly sentCount: number;
  readonly failedCount: number;
  readonly createdAt: string;
}

/** The last few sends, so an admin can see a message went out and to how many. */
export async function readRecentNotifications(
  admin: SupabaseClient<Database>,
  tenantId: string,
  limit = 15,
): Promise<readonly SentNotificationRow[]> {
  const { data } = await admin
    .from("notification_deliveries")
    .select("id, kind, sent_count, failed_count, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    createdAt: row.created_at,
  }));
}
