/**
 * One call site for "tell the students about this" (D-34).
 *
 * Every trigger — an announcement posted, an away request decided, a menu
 * published, a plan about to end — goes through here, so they all share the
 * same guarantee: **notifying can never fail the thing that caused it.**
 *
 * That is the whole reason this wrapper exists rather than each action wiring
 * up the use case itself. An admin who has just posted an announcement has
 * posted it; whether Firebase accepted the push is not their problem, is not
 * shown to them, and must not roll anything back.
 */
import "server-only";
import { notifyStudents, type NotifyInput, type NotifyOutcome } from "@/core/services/notify";
import { createPushSender } from "@/infra/push/fcm";
import { createAdminClient } from "@/infra/supabase/admin";
import {
  SupabaseDeviceTokenRepository,
  SupabaseNotificationDeliveryRepository,
} from "@/infra/supabase/repositories";

export async function dispatchNotification(
  tenantId: string,
  input: NotifyInput,
): Promise<NotifyOutcome> {
  try {
    const admin = createAdminClient();
    const result = await notifyStudents(tenantId, input, {
      devices: new SupabaseDeviceTokenRepository(admin),
      deliveries: new SupabaseNotificationDeliveryRepository(admin),
      push: createPushSender(),
    });

    return result.ok ? result.value : { sent: 0, failed: 0, skipped: "SEND_FAILED" };
  } catch {
    // Anything at all — an unreachable database, a malformed credential — is
    // swallowed here. The caller's work has already succeeded.
    return { sent: 0, failed: 0, skipped: "SEND_FAILED" };
  }
}
