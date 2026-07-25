"use server";

/**
 * Plan mutations.
 *
 * Validation and the rupee → paise conversion live in
 * `src/core/policies/plan.policy.ts`; these actions authenticate, parse the form,
 * call the policy, and map the result (rule 2).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ALL_MEAL_SLOTS, type MealSlot } from "@/core/domain/enums";
import { parsePlanDraft } from "@/core/policies/plan.policy";
import { createAdminClient } from "@/infra/supabase/admin";
import { getSessionUser } from "@/infra/auth/session";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";

export interface PlanActionState {
  readonly error?: string;
  readonly success?: string;
}

const formSchema = z.object({
  name: z.string(),
  // Kept as a string here: `Number("")` is 0, which would silently create a free
  // plan when the admin simply left the field blank.
  priceRupees: z.string().trim().min(1, "Enter a price"),
  durationType: z.enum(["MONTHLY", "QUARTERLY"]),
  durationDays: z.coerce.number(),
  mealSlots: z.array(z.enum(["BREAKFAST", "LUNCH", "SNACKS", "DINNER"])),
});

function readForm(formData: FormData) {
  const slots = formData
    .getAll("mealSlots")
    .map(String)
    .filter((s): s is MealSlot => (ALL_MEAL_SLOTS as readonly string[]).includes(s));

  return formSchema.safeParse({
    name: formData.get("name") ?? "",
    priceRupees: formData.get("priceRupees") ?? "",
    durationType: formData.get("durationType") ?? "MONTHLY",
    durationDays: formData.get("durationDays") ?? "0",
    mealSlots: slots,
  });
}

export async function createPlan(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  const parsed = readForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const priceRupees = Number(parsed.data.priceRupees);
  const draft = parsePlanDraft({
    actorRole: user.role,
    name: parsed.data.name,
    priceRupees,
    durationType: parsed.data.durationType,
    durationDays: parsed.data.durationDays,
    mealSlots: parsed.data.mealSlots,
  });

  if (!draft.ok) return { error: draft.error.message };

  const admin = createAdminClient();
  const { data: created, error } = await admin
    .from("plans")
    .insert({
      tenant_id: user.tenantId,
      name: draft.value.name,
      price_paise: draft.value.pricePaise,
      duration_type: draft.value.durationType,
      duration_days: draft.value.durationDays,
      included_meal_slots: [...draft.value.mealSlots],
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    // Migration 005 makes the name unique per tenant, case-insensitively. Two
    // plans called "Monthly" would be indistinguishable in the picker, and
    // picking the wrong one snapshots the wrong price permanently.
    if (error.code === "23505") {
      return { error: `A plan called "${draft.value.name}" already exists.` };
    }
    return { error: `Could not create the plan: ${error.message}` };
  }

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "PLAN_CREATED",
    entityType: "plan",
    entityId: created.id,
    after: {
      name: draft.value.name,
      pricePaise: draft.value.pricePaise,
      durationDays: draft.value.durationDays,
    },
  });

  revalidatePath("/admin/plans");
  return { success: `Plan "${draft.value.name}" created.` };
}

export async function updatePlan(
  planId: string,
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  const parsed = readForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const draft = parsePlanDraft({
    actorRole: user.role,
    name: parsed.data.name,
    priceRupees: Number(parsed.data.priceRupees),
    durationType: parsed.data.durationType,
    durationDays: parsed.data.durationDays,
    mealSlots: parsed.data.mealSlots,
  });
  if (!draft.ok) return { error: draft.error.message };

  const admin = createAdminClient();

  const { data: before } = await admin
    .from("plans")
    .select("name, price_paise, duration_days, included_meal_slots")
    .eq("id", planId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  if (!before) return { error: "Plan not found." };

  const { error } = await admin
    .from("plans")
    .update({
      name: draft.value.name,
      price_paise: draft.value.pricePaise,
      duration_type: draft.value.durationType,
      duration_days: draft.value.durationDays,
      included_meal_slots: [...draft.value.mealSlots],
    })
    .eq("id", planId)
    .eq("tenant_id", user.tenantId);

  if (error) {
    if (error.code === "23505") {
      return { error: `A plan called "${draft.value.name}" already exists.` };
    }
    return { error: `Could not save the plan: ${error.message}` };
  }

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "PLAN_UPDATED",
    entityType: "plan",
    entityId: planId,
    before: {
      name: before.name,
      pricePaise: before.price_paise,
      durationDays: before.duration_days,
    },
    after: {
      name: draft.value.name,
      pricePaise: draft.value.pricePaise,
      durationDays: draft.value.durationDays,
    },
  });

  revalidatePath("/admin/plans");
  // Existing subscriptions keep their snapshot, which is the whole point — say
  // so, because an owner raising a price will reasonably wonder.
  return {
    success: `Plan saved. Students already on this plan keep the price they were given.`,
  };
}

export async function setPlanActive(planId: string, isActive: boolean): Promise<PlanActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { error: "Only an admin can retire a plan." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("plans")
    .update({ is_active: isActive })
    .eq("id", planId)
    .eq("tenant_id", user.tenantId);

  if (error) return { error: `Could not update the plan: ${error.message}` };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: isActive ? "PLAN_REACTIVATED" : "PLAN_RETIRED",
    entityType: "plan",
    entityId: planId,
    after: { isActive },
  });

  revalidatePath("/admin/plans");
  return {
    success: isActive
      ? "Plan is available again."
      : "Plan retired. Students already on it are unaffected.",
  };
}
