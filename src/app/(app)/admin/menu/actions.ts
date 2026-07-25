"use server";

/**
 * Menu publishing.
 *
 * Upserts on `(tenant_id, service_date, meal_slot)`, which is the table's unique
 * constraint — so re-publishing the same slot corrects it rather than creating a
 * second competing menu (rule 5).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { MealSlot } from "@/core/domain/enums";
import { parseMenuDraft } from "@/core/policies/menu.policy";
import { serviceDateOf, toServiceDate } from "@/core/time";
import { createAdminClient } from "@/infra/supabase/admin";
import { createClient } from "@/infra/supabase/server";
import { getSessionUser } from "@/infra/auth/session";
import {
  SupabaseAuditLogRepository,
  SupabaseTenantRepository,
} from "@/infra/supabase/repositories";

export interface MenuActionState {
  readonly error?: string;
  readonly success?: string;
}

const schema = z.object({
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date"),
  mealSlot: z.enum(["BREAKFAST", "LUNCH", "SNACKS", "DINNER"]),
  // One item per line: the fastest thing to type on a phone in a kitchen.
  items: z.string().max(8000),
  notes: z.string().max(500),
});

export async function publishMenu(
  _prev: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  const parsed = schema.safeParse({
    serviceDate: formData.get("serviceDate"),
    mealSlot: formData.get("mealSlot"),
    items: formData.get("items") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const settings = await new SupabaseTenantRepository(supabase, admin).getSettings(user.tenantId);
  if (!settings) return { error: "This mess has no meal times configured yet." };

  const draft = parseMenuDraft({
    actorRole: user.role,
    serviceDate: toServiceDate(parsed.data.serviceDate),
    mealSlot: parsed.data.mealSlot,
    items: parsed.data.items.split("\n"),
    notes: parsed.data.notes,
    servedSlots: settings.mealSlots.map((s) => s.slot),
    today: serviceDateOf(user.timezone, new Date()),
  });

  if (!draft.ok) return { error: draft.error.message };

  const { error } = await admin.from("menus").upsert(
    {
      tenant_id: user.tenantId,
      service_date: draft.value.serviceDate,
      meal_slot: draft.value.mealSlot,
      items: [...draft.value.items],
      notes: draft.value.notes,
      published_by: user.actorProfileId,
    },
    // Re-publishing the same date and slot is a correction, not a duplicate.
    { onConflict: "tenant_id,service_date,meal_slot" },
  );

  if (error) return { error: `Could not publish the menu: ${error.message}` };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "MENU_PUBLISHED",
    entityType: "menu",
    entityId: null,
    after: {
      serviceDate: draft.value.serviceDate,
      mealSlot: draft.value.mealSlot,
      itemCount: draft.value.items.length,
    },
  });

  revalidatePath("/admin/menu");
  revalidatePath("/student/menu");
  revalidatePath("/student");

  return { success: `${draft.value.mealSlot.toLowerCase()} menu published.` };
}

export async function clearMenu(serviceDate: string, mealSlot: MealSlot): Promise<MenuActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { error: "Only an admin can change the menu." };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return { error: "Invalid date." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("menus")
    .delete()
    .eq("tenant_id", user.tenantId)
    .eq("service_date", serviceDate)
    .eq("meal_slot", mealSlot);

  if (error) return { error: `Could not clear the menu: ${error.message}` };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "MENU_CLEARED",
    entityType: "menu",
    entityId: null,
    before: { serviceDate, mealSlot },
  });

  revalidatePath("/admin/menu");
  revalidatePath("/student/menu");
  revalidatePath("/student");

  return { success: "Menu cleared." };
}
