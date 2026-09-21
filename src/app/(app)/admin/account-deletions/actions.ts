"use server";

/**
 * Completing or cancelling a student's deletion request (D-32).
 *
 * Audit-logged without exception, and for a harder reason than most screens:
 * completing one is the only irreversible action in this product. Afterwards
 * there is no name left to ask about, so the log is the only record that the
 * mess did what it promised — and the only defence if someone later claims it
 * did not.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isErr } from "@/core/result";
import { cancelAccountDeletion, completeAccountDeletion } from "@/core/services/account-deletion";
import { getSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import {
  SupabaseAccountDeletionRepository,
  SupabaseAuditLogRepository,
} from "@/infra/supabase/repositories";

export interface DeletionActionState {
  readonly error?: string;
  readonly success?: string;
}

const schema = z.object({
  id: z.uuid(),
  outcome: z.enum(["COMPLETE", "CANCEL"]),
  note: z.string().max(500).optional(),
  /**
   * Typed, not clicked. Erasure cannot be undone, and a button that only needs
   * a click is a button that gets clicked on the wrong row.
   */
  confirm: z.string().optional(),
});

export async function decideAccountDeletion(
  _prev: DeletionActionState,
  formData: FormData,
): Promise<DeletionActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  const parsed = schema.safeParse({
    id: formData.get("id"),
    outcome: formData.get("outcome"),
    note: formData.get("note") ?? undefined,
    confirm: formData.get("confirm") ?? undefined,
  });
  if (!parsed.success) return { error: "That decision could not be read. Try again." };

  if (parsed.data.outcome === "COMPLETE" && parsed.data.confirm?.trim().toUpperCase() !== "ERASE") {
    return { error: "Type ERASE to confirm. This cannot be undone." };
  }

  const admin = createAdminClient();
  const repo = new SupabaseAccountDeletionRepository(admin);
  const before = await repo.byId(user.tenantId, parsed.data.id);

  const deps = { repo, now: () => new Date() };
  const result =
    parsed.data.outcome === "COMPLETE"
      ? await completeAccountDeletion(
          user,
          { requestId: parsed.data.id, note: parsed.data.note },
          deps,
        )
      : await cancelAccountDeletion(
          user,
          { requestId: parsed.data.id, note: parsed.data.note },
          deps,
        );

  if (isErr(result)) return { error: result.error.message };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action:
      parsed.data.outcome === "COMPLETE"
        ? "ACCOUNT_DELETION_COMPLETED"
        : "ACCOUNT_DELETION_CANCELLED",
    entityType: "profile",
    entityId: result.value.profileId,
    // The roll number as it was, so the log identifies the request without
    // carrying the name that erasure has just removed.
    before: { rollNumber: before?.rollNumber ?? null, status: before?.status ?? null },
    after: { status: result.value.status, note: result.value.note },
  });

  revalidatePath("/admin/account-deletions");

  return {
    success:
      parsed.data.outcome === "COMPLETE"
        ? "Erased. The student's name, contact details and photo are gone; attendance and billing stay, unlinked."
        : "Cancelled. The student can sign in again.",
  };
}
