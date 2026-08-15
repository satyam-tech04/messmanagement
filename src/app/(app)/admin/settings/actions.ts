"use server";

/**
 * Mess settings.
 *
 * Meal windows gate every scan, so a change here is audit-logged: "why were
 * students refused at 19:00 last Tuesday?" is answerable only if the window
 * change is recorded with who made it.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ALL_MEAL_SLOTS, type MealSlot } from "@/core/domain/enums";
import { parseTenantSettings } from "@/core/policies/tenant-settings.policy";
import { createAdminClient } from "@/infra/supabase/admin";
import { getSessionUser } from "@/infra/auth/session";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";

export interface SettingsActionState {
  readonly error?: string;
  readonly success?: string;
}

const schema = z.object({
  qrTokenTtlSeconds: z.coerce.number(),
  qrRefreshSeconds: z.coerce.number(),
});

export async function updateSettings(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  const parsed = schema.safeParse({
    qrTokenTtlSeconds: formData.get("qrTokenTtlSeconds"),
    qrRefreshSeconds: formData.get("qrRefreshSeconds"),
  });
  if (!parsed.success) return { error: "Check the QR rotation values." };

  // Only slots the admin ticked are served. An unticked meal is removed rather
  // than kept with stale times, so the settings screen is the whole truth.
  const mealSlots = ALL_MEAL_SLOTS.filter((slot) => formData.get(`enabled_${slot}`) === "on").map(
    (slot) => ({
      slot: slot as MealSlot,
      start: String(formData.get(`start_${slot}`) ?? ""),
      end: String(formData.get(`end_${slot}`) ?? ""),
    }),
  );

  // Only what ACTIVE PLANS still offer. Subscription snapshots are frozen
  // history and can never be edited, so keying on them would deadlock this
  // screen forever the moment one old subscription mentioned a meal.
  const admin = createAdminClient();
  const { data: activePlans } = await admin
    .from("plans")
    .select("included_meal_slots")
    .eq("tenant_id", user.tenantId)
    .eq("is_active", true);

  const slotsInUse = [
    ...new Set((activePlans ?? []).flatMap((p) => p.included_meal_slots as MealSlot[])),
  ];

  const draft = parseTenantSettings({
    actorRole: user.role,
    mealSlots,
    slotsInUse,
    qrTokenTtlSeconds: parsed.data.qrTokenTtlSeconds,
    qrRefreshSeconds: parsed.data.qrRefreshSeconds,
  });
  if (!draft.ok) return { error: draft.error.message };

  const { data: before } = await admin
    .from("tenant_settings")
    .select("meal_slots, qr_token_ttl_seconds, qr_refresh_seconds")
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  const { error } = await admin
    .from("tenant_settings")
    .update({
      meal_slots: draft.value.mealSlots.map((s) => ({
        slot: s.slot,
        start: s.start,
        end: s.end,
      })),
      qr_token_ttl_seconds: draft.value.qrTokenTtlSeconds,
      qr_refresh_seconds: draft.value.qrRefreshSeconds,
    })
    .eq("tenant_id", user.tenantId);

  if (error) return { error: `Could not save: ${error.message}` };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "TENANT_SETTINGS_UPDATED",
    entityType: "tenant_settings",
    entityId: user.tenantId,
    before: before ?? null,
    after: {
      mealSlots: draft.value.mealSlots,
      qrTokenTtlSeconds: draft.value.qrTokenTtlSeconds,
      qrRefreshSeconds: draft.value.qrRefreshSeconds,
    },
  });

  // Meal times feed the menu planner, the QR screen and the scanner.
  revalidatePath("/admin/settings");
  revalidatePath("/admin/menu");
  revalidatePath("/admin/headcount");
  revalidatePath("/student");
  revalidatePath("/staff");

  return { success: "Settings saved. Meal times apply to the next scan." };
}
