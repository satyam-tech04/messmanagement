/**
 * Sending a notification to students (D-34).
 *
 * `notification.policy.ts` decides what it says and who wants it. This use case
 * owns the fan-out, which is where push goes wrong:
 *
 *   * **A retry must send nothing.** The dedupe key is claimed against a unique
 *     index before a single message goes out. A cron that is retried, or an
 *     admin who saves an announcement twice, buzzes nobody a second time.
 *   * **Push failing must not fail the thing that caused it.** An announcement
 *     is the product; telling phones about it is a courtesy. A missing Firebase
 *     project, or an outage, returns a skipped result — never an error the
 *     admin's save has to handle.
 *   * **Dead tokens are thrown away.** An uninstalled app leaves its token
 *     behind forever, and keeping it means a failed send on every announcement
 *     from now on.
 */
import {
  buildNotification,
  wantsNotification,
  type NotificationKind,
} from "../policies/notification.policy";
import type {
  DeviceTokenRepository,
  NotificationDeliveryRepository,
  NotificationRecipient,
  PushSender,
} from "../ports/repositories";
import { ok, type Result } from "../result";
import type { DomainError } from "../errors";

export interface NotifyInput {
  readonly kind: NotificationKind;
  readonly tenantName: string;
  readonly title: string;
  readonly body: string;
  /** What makes this event unique. See `deliveryKey` in the policy. */
  readonly dedupeKey: string;
  /** Everyone, or the specific students this concerns. */
  readonly audience: "ALL_STUDENTS" | readonly string[];
}

export interface NotifyDeps {
  readonly devices: DeviceTokenRepository;
  readonly deliveries: NotificationDeliveryRepository;
  readonly push: PushSender;
}

export interface NotifyOutcome {
  readonly sent: number;
  readonly failed: number;
  /** Why nothing was sent, when nothing was. */
  readonly skipped: "PUSH_DISABLED" | "ALREADY_SENT" | "SEND_FAILED" | null;
}

const nothing = (skipped: NotifyOutcome["skipped"]): NotifyOutcome => ({
  sent: 0,
  failed: 0,
  skipped,
});

export async function notifyStudents(
  tenantId: string,
  input: NotifyInput,
  deps: NotifyDeps,
): Promise<Result<NotifyOutcome, DomainError>> {
  // Checked before the dedupe key is claimed. Claiming it here would record an
  // event as delivered that nobody received, and the day credentials are added
  // it would stay silent forever.
  if (!deps.push.enabled) return ok(nothing("PUSH_DISABLED"));

  const audience = input.audience;
  if (audience !== "ALL_STUDENTS" && audience.length === 0) return ok(nothing(null));

  const recipients: readonly NotificationRecipient[] =
    audience === "ALL_STUDENTS"
      ? await deps.devices.studentsOf(tenantId)
      : await deps.devices.byProfileIds(tenantId, audience);

  const tokens = recipients
    .filter((r) => wantsNotification(input.kind, r))
    .flatMap((r) => r.tokens);

  if (tokens.length === 0) return ok(nothing(null));

  // Claimed only once there is somebody to tell, so a send that reached nobody
  // does not burn the key for an event that could be sent again.
  const claimed = await deps.deliveries.claim(tenantId, input.kind, input.dedupeKey);
  if (!claimed) return ok(nothing("ALREADY_SENT"));

  const message = buildNotification(input);

  let result;
  try {
    result = await deps.push.send(tokens, message);
  } catch {
    // The transport is down. The caller's own work has already succeeded and
    // must not be rolled back because Firebase was unreachable.
    return ok(nothing("SEND_FAILED"));
  }

  if (result.deadTokens.length > 0) await deps.devices.prune(result.deadTokens);

  await deps.deliveries.record(tenantId, input.kind, input.dedupeKey, {
    sent: result.sent,
    failed: result.failed,
  });

  return ok({ sent: result.sent, failed: result.failed, skipped: null });
}
