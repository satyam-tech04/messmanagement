"use server";

/**
 * Sending a notification an admin has typed (D-34).
 *
 * The only thing in this product that reaches hundreds of people at once and
 * cannot be taken back. So: the policy decides whether the actor may send it
 * and whether the text is usable, the audience is resolved server-side from
 * ids the admin picked, and every send is written to the audit log with what
 * was said — "who sent that at 11pm?" has to be answerable.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NotificationKind, parseManualNotification } from "@/core/policies/notification.policy";
import { isErr } from "@/core/result";
import { getSessionUser } from "@/infra/auth/session";
import { dispatchNotification } from "@/infra/notify/dispatch";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";

export interface SendNotificationState {
  readonly error?: string;
  readonly success?: string;
}

const schema = z.object({
  title: z.string().max(200),
  body: z.string().max(1000),
  audience: z.enum(["ALL", "SELECTED"]),
  // The picker posts one entry per ticked student.
  profileIds: z.array(z.uuid()).max(2000),
});

export async function sendManualNotification(
  _prev: SendNotificationState,
  formData: FormData,
): Promise<SendNotificationState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  const parsedForm = schema.safeParse({
    title: formData.get("title") ?? "",
    body: formData.get("body") ?? "",
    audience: formData.get("audience") ?? "ALL",
    profileIds: formData.getAll("profileIds").map(String),
  });
  if (!parsedForm.success) return { error: "That message could not be read. Try again." };

  const message = parseManualNotification({
    actorRole: user.role,
    title: parsedForm.data.title,
    body: parsedForm.data.body,
  });
  if (isErr(message)) return { error: message.error.message };

  const toEveryone = parsedForm.data.audience === "ALL";
  if (!toEveryone && parsedForm.data.profileIds.length === 0) {
    return { error: "Choose at least one student, or send to everyone." };
  }

  const outcome = await dispatchNotification(user.tenantId, {
    kind: NotificationKind.ANNOUNCEMENT,
    tenantName: user.tenantName,
    title: message.value.title,
    body: message.value.body,
    // Every manual send is its own event. Unlike an announcement, which is
    // keyed to its row so an edit cannot re-notify, two identical messages sent
    // an hour apart are two deliberate acts.
    dedupeKey: `MANUAL:${randomUUID()}`,
    audience: toEveryone ? "ALL_STUDENTS" : parsedForm.data.profileIds,
  });

  const admin = createAdminClient();
  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "NOTIFICATION_SENT",
    entityType: "notification",
    entityId: null,
    after: {
      title: message.value.title,
      body: message.value.body,
      audience: toEveryone ? "ALL_STUDENTS" : `${parsedForm.data.profileIds.length} selected`,
      sent: outcome.sent,
      failed: outcome.failed,
      skipped: outcome.skipped,
    },
  });

  revalidatePath("/admin/notifications");

  if (outcome.skipped === "PUSH_DISABLED") {
    return {
      error:
        "Nothing was sent: push is not configured on this deployment yet. The message was not delivered to anyone.",
    };
  }
  if (outcome.skipped === "SEND_FAILED") {
    return { error: "The notification service could not be reached. Nobody received this." };
  }
  if (outcome.sent === 0) {
    return {
      error:
        "Nobody to send to. These students either have not installed the app or have switched announcements off.",
    };
  }

  return {
    success: `Sent to ${outcome.sent} device${outcome.sent === 1 ? "" : "s"}.${
      outcome.failed > 0 ? ` ${outcome.failed} could not be reached.` : ""
    }`,
  };
}
