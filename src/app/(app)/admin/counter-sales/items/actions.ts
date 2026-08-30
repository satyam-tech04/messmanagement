"use server";

/**
 * The counter-sales catalogue.
 *
 * Admin-only, because staff must never see a price field anywhere in this
 * feature (spec §14). Every rule about what makes an item valid lives in
 * `counter-sales.policy.ts`; this validates the form, calls it, and maps the
 * result.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseCounterItemDraft } from "@/core/policies/counter-sales.policy";
import { createAdminClient } from "@/infra/supabase/admin";
import { getSessionUser } from "@/infra/auth/session";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";

export interface CounterItemActionState {
  readonly error?: string;
  readonly success?: string;
}

const itemSchema = z.object({
  itemName: z.string(),
  unit: z.string(),
  // A string, not a coerced number: `Number("")` is 0, which would look like a
  // deliberately free item rather than a field the admin left blank.
  priceRupees: z.string().trim().min(1, "Enter a price"),
});

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." as const };
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { error: "Only an admin can manage counter items." as const };
  }
  return { user, admin: createAdminClient() };
}

export async function createCounterItem(
  _prev: CounterItemActionState,
  formData: FormData,
): Promise<CounterItemActionState> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const parsed = itemSchema.safeParse({
    itemName: formData.get("itemName") ?? "",
    unit: formData.get("unit") ?? "",
    priceRupees: formData.get("priceRupees") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const draft = parseCounterItemDraft({
    actorRole: user.role,
    itemName: parsed.data.itemName,
    unit: parsed.data.unit,
    priceRupees: Number(parsed.data.priceRupees),
  });
  if (!draft.ok) return { error: draft.error.message };

  // Allocated under a row lock, per mess. Never max()+1 from application code:
  // two admins adding an item at once would be handed the same code, and the
  // code is stamped onto every bill that item ever appears on.
  const { data: itemCode, error: codeError } = await admin.rpc("allocate_counter_item_code", {
    p_tenant_id: user.tenantId,
  });
  if (codeError || !itemCode) {
    return {
      error: `Could not allocate an item code: ${codeError?.message ?? "no code returned"}`,
    };
  }

  const { data: created, error } = await admin
    .from("counter_items")
    .insert({
      tenant_id: user.tenantId,
      item_code: itemCode,
      item_name: draft.value.itemName,
      unit: draft.value.unit,
      price_paise: draft.value.pricePaise,
      is_active: true,
    })
    .select("id")
    .single();
  if (error) return { error: `Could not add the item: ${error.message}` };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "COUNTER_ITEM_CREATED",
    entityType: "counter_item",
    entityId: created.id,
    after: {
      itemCode,
      itemName: draft.value.itemName,
      unit: draft.value.unit,
      pricePaise: draft.value.pricePaise,
    },
  });

  revalidatePath("/admin/counter-sales/items");
  return { success: `${draft.value.itemName} added as ${itemCode}.` };
}

export async function updateCounterItem(
  itemId: string,
  _prev: CounterItemActionState,
  formData: FormData,
): Promise<CounterItemActionState> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const parsed = itemSchema.safeParse({
    itemName: formData.get("itemName") ?? "",
    unit: formData.get("unit") ?? "",
    priceRupees: formData.get("priceRupees") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const draft = parseCounterItemDraft({
    actorRole: user.role,
    itemName: parsed.data.itemName,
    unit: parsed.data.unit,
    priceRupees: Number(parsed.data.priceRupees),
  });
  if (!draft.ok) return { error: draft.error.message };

  // The item_code is deliberately absent from this update. It is stamped onto
  // every bill line that already references the item, and reassigning it would
  // make history disagree with the catalogue.
  const { error, count } = await admin
    .from("counter_items")
    .update(
      {
        item_name: draft.value.itemName,
        unit: draft.value.unit,
        price_paise: draft.value.pricePaise,
      },
      { count: "exact" },
    )
    .eq("id", itemId)
    .eq("tenant_id", user.tenantId);

  if (error) return { error: `Could not update the item: ${error.message}` };
  if (count === 0) return { error: "That item no longer exists. Reload the page." };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "COUNTER_ITEM_UPDATED",
    entityType: "counter_item",
    entityId: itemId,
    after: {
      itemName: draft.value.itemName,
      unit: draft.value.unit,
      pricePaise: draft.value.pricePaise,
    },
  });

  // Existing bill lines are untouched by design: they hold their own snapshot
  // of the name, unit and price (spec §12).
  revalidatePath("/admin/counter-sales/items");
  return { success: `${draft.value.itemName} updated. Existing bills are unchanged.` };
}

/**
 * Deactivates or reactivates an item.
 *
 * Always a soft delete. Spec §3 allows a hard delete for an item never used on
 * a bill, but the saving is nil and the risk is not: the check would have to be
 * exactly right, forever, or a used item disappears from somebody's receipt.
 */
export async function setCounterItemActive(
  itemId: string,
  isActive: boolean,
): Promise<CounterItemActionState> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const { error, count } = await admin
    .from("counter_items")
    .update({ is_active: isActive }, { count: "exact" })
    .eq("id", itemId)
    .eq("tenant_id", user.tenantId);

  if (error) return { error: `Could not update the item: ${error.message}` };
  if (count === 0) return { error: "That item no longer exists. Reload the page." };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: isActive ? "COUNTER_ITEM_REACTIVATED" : "COUNTER_ITEM_DEACTIVATED",
    entityType: "counter_item",
    entityId: itemId,
    after: { isActive },
  });

  revalidatePath("/admin/counter-sales/items");
  return {
    success: isActive
      ? "Item is back on the counter list."
      : "Item hidden from new bills. Existing bills still show it.",
  };
}
