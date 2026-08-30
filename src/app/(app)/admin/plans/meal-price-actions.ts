"use server";

/**
 * The meal rate card.
 *
 * Four numbers per mess — what one breakfast, lunch, snack and dinner are worth.
 * They do exactly one thing: suggest a plan's base premium when an admin builds
 * a new plan. Nothing downstream reads them. A plan freezes its own price at
 * creation, and a subscription freezes the plan's, so changing a rate here can
 * never reach a plan that already exists or a student already on one.
 *
 * That is the whole point of the layering, and it is why this action is allowed
 * to be as simple as it looks.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ALL_MEAL_SLOTS, type MealSlot } from "@/core/domain/enums";
import { parseMealPrice } from "@/core/policies/pricing.policy";
import { createAdminClient } from "@/infra/supabase/admin";
import { getSessionUser } from "@/infra/auth/session";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";

export interface MealPriceActionState {
  readonly error?: string;
  readonly success?: string;
}

const schema = z.object({
  mealSlot: z.enum(ALL_MEAL_SLOTS as unknown as [MealSlot, ...MealSlot[]]),
  priceRupees: z.coerce.number(),
});

export async function setMealPrice(
  _prev: MealPriceActionState,
  formData: FormData,
): Promise<MealPriceActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { error: "Only an admin can set meal prices." };
  }

  const parsed = schema.safeParse({
    mealSlot: formData.get("mealSlot"),
    priceRupees: formData.get("priceRupees"),
  });
  if (!parsed.success) return { error: "Enter a valid price." };

  const decision = parseMealPrice({
    actorRole: user.role,
    mealSlot: parsed.data.mealSlot,
    priceRupees: parsed.data.priceRupees,
  });
  if (!decision.ok) return { error: decision.error.message };

  const admin = createAdminClient();
  const { error } = await admin.from("meal_prices").upsert(
    {
      tenant_id: user.tenantId,
      meal_slot: decision.value.mealSlot,
      price_paise: decision.value.pricePaise,
    },
    // The unique index is what makes this idempotent: setting lunch to ₹60
    // twice writes one row, not two, however many times the form is submitted.
    { onConflict: "tenant_id,meal_slot" },
  );
  if (error) return { error: `Could not save the price: ${error.message}` };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "MEAL_PRICE_SET",
    entityType: "meal_price",
    entityId: null,
    after: { mealSlot: decision.value.mealSlot, pricePaise: decision.value.pricePaise },
  });

  revalidatePath("/admin/plans");
  return { success: `${decision.value.mealSlot.toLowerCase()} price saved.` };
}
