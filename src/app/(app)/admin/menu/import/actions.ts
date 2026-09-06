"use server";

/**
 * Importing a month of menus from a mess's own spreadsheet.
 *
 * Two passes, matching the student importer: `previewMenuImport` parses and
 * reports without writing anything, then `commitMenuImport` applies exactly
 * what the preview showed. An admin filling a month of food should see what is
 * about to happen — especially how many already-published days it will
 * replace — before it happens.
 *
 * Every rule about what a row means lives in `menu-import.policy.ts`.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { MealSlot } from "@/core/domain/enums";
import {
  expandWeeklyMenu,
  parseMenuImport,
  type MenuImportError,
} from "@/core/policies/menu-import.policy";
import { isServiceDate, toServiceDate } from "@/core/time";
import { parseCsv } from "@/lib/csv";
import { createAdminClient } from "@/infra/supabase/admin";
import { getSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import {
  SupabaseAuditLogRepository,
  SupabaseTenantRepository,
} from "@/infra/supabase/repositories";

export interface MenuImportState {
  readonly error?: string;
  readonly success?: string;
  readonly preview?: {
    readonly csv: string;
    readonly from: string;
    readonly to: string;
    readonly errors: readonly MenuImportError[];
    /** One line per weekday/meal in the rotation, for the admin to read back. */
    readonly week: readonly {
      readonly day: string;
      readonly meal: string;
      readonly items: string;
    }[];
    readonly counterItems: readonly { readonly name: string; readonly price: string }[];
    readonly days: number;
    readonly replacing: number;
    readonly newItems: number;
    readonly repricedItems: number;
  };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const schema = z.object({
  csv: z.string().min(1, "Choose a CSV file."),
  from: z.string().refine(isServiceDate, "Enter a valid start date."),
  to: z.string().refine(isServiceDate, "Enter a valid end date."),
});

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." as const };
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { error: "Only an admin can import menus." as const };
  }
  return { user, admin: createAdminClient() };
}

/** Parses and counts, writing nothing. */
export async function previewMenuImport(
  _prev: MenuImportState,
  formData: FormData,
): Promise<MenuImportState> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const parsed = schema.safeParse({
    csv: formData.get("csv") ?? "",
    from: formData.get("from") ?? "",
    to: formData.get("to") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const settings = await new SupabaseTenantRepository(await createClient(), admin).getSettings(
    user.tenantId,
  );
  const servedSlots = (settings?.mealSlots ?? []).map((s) => s.slot);

  const result = parseMenuImport({ rows: parseCsv(parsed.data.csv), servedSlots });

  const from = toServiceDate(parsed.data.from);
  const to = toServiceDate(parsed.data.to);
  const days = expandWeeklyMenu(result.menu, from, to);

  // How many published days this would overwrite. The single most useful number
  // on the screen: replacing a month of menus somebody already typed is not
  // something to discover afterwards.
  const { data: existing } = await admin
    .from("menus")
    .select("service_date, meal_slot")
    .eq("tenant_id", user.tenantId)
    .gte("service_date", from)
    .lte("service_date", to);

  const existingKeys = new Set((existing ?? []).map((m) => `${m.service_date}|${m.meal_slot}`));
  const replacing = days.filter((d) => existingKeys.has(`${d.serviceDate}|${d.mealSlot}`)).length;

  // Counter items are matched by name, so a re-import reprices rather than
  // creating a second Tea.
  const { data: currentItems } = await admin
    .from("counter_items")
    .select("item_name, price_paise")
    .eq("tenant_id", user.tenantId);
  const byName = new Map(
    (currentItems ?? []).map((i) => [i.item_name.toLowerCase(), i.price_paise]),
  );
  const newItems = result.counterItems.filter((i) => !byName.has(i.itemName.toLowerCase())).length;
  const repricedItems = result.counterItems.filter((i) => {
    const current = byName.get(i.itemName.toLowerCase());
    return current !== undefined && current !== i.pricePaise;
  }).length;

  return {
    preview: {
      csv: parsed.data.csv,
      from,
      to,
      errors: result.errors,
      week: result.menu.map((entry) => ({
        day: DAY_NAMES[entry.weekday] ?? String(entry.weekday),
        meal: entry.mealSlot.charAt(0) + entry.mealSlot.slice(1).toLowerCase(),
        items: entry.items.join(", "),
      })),
      counterItems: result.counterItems.map((i) => ({
        name: i.itemName,
        price: `₹${(i.pricePaise / 100).toFixed(2)}`,
      })),
      days: days.length,
      replacing,
      newItems,
      repricedItems,
    },
  };
}

/** Applies what the preview showed. Refuses while any row is in error. */
export async function commitMenuImport(
  _prev: MenuImportState,
  formData: FormData,
): Promise<MenuImportState> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const parsed = schema.safeParse({
    csv: formData.get("csv") ?? "",
    from: formData.get("from") ?? "",
    to: formData.get("to") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const settings = await new SupabaseTenantRepository(await createClient(), admin).getSettings(
    user.tenantId,
  );
  const servedSlots = (settings?.mealSlots ?? []).map((s) => s.slot);

  const result = parseMenuImport({ rows: parseCsv(parsed.data.csv), servedSlots });

  // All-or-nothing on errors. A partial import of somebody's month leaves them
  // unable to tell which days are real without checking all thirty.
  if (result.errors.length > 0) {
    return { error: "Fix the problems listed above and upload the file again." };
  }

  const from = toServiceDate(parsed.data.from);
  const to = toServiceDate(parsed.data.to);
  const days = expandWeeklyMenu(result.menu, from, to);

  if (days.length === 0 && result.counterItems.length === 0) {
    return { error: "That date range contains none of the days in the file." };
  }

  // --- The menus -----------------------------------------------------------
  if (days.length > 0) {
    const { error } = await admin.from("menus").upsert(
      days.map((d) => ({
        tenant_id: user.tenantId,
        service_date: d.serviceDate,
        meal_slot: d.mealSlot as MealSlot,
        items: [...d.items],
        published_by: user.actorProfileId,
      })),
      // The unique index is what makes a re-import idempotent: running the same
      // file twice replaces those days rather than failing or duplicating them.
      { onConflict: "tenant_id,service_date,meal_slot" },
    );
    if (error) return { error: `Could not save the menus: ${error.message}` };
  }

  // --- The extras ----------------------------------------------------------
  let created = 0;
  let repriced = 0;
  for (const item of result.counterItems) {
    const { data: match } = await admin
      .from("counter_items")
      .select("id, price_paise")
      .eq("tenant_id", user.tenantId)
      .ilike("item_name", item.itemName)
      .maybeSingle();

    if (match) {
      // Matched by name, so re-importing reprices rather than creating a second
      // Tea. The item_code is never touched — it is stamped on every bill line
      // that already references it.
      if (match.price_paise !== item.pricePaise) {
        await admin
          .from("counter_items")
          .update({ price_paise: item.pricePaise, is_active: true })
          .eq("id", match.id);
        repriced += 1;
      }
      continue;
    }

    const { data: itemCode } = await admin.rpc("allocate_counter_item_code", {
      p_tenant_id: user.tenantId,
    });
    if (!itemCode) return { error: "Could not allocate an item code." };

    const { error } = await admin.from("counter_items").insert({
      tenant_id: user.tenantId,
      item_code: itemCode,
      item_name: item.itemName,
      unit: item.unit,
      price_paise: item.pricePaise,
      is_active: true,
    });
    if (error) return { error: `Could not add ${item.itemName}: ${error.message}` };
    created += 1;
  }

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "MENU_IMPORTED",
    entityType: "menu",
    entityId: null,
    after: {
      from,
      to,
      mealsPublished: days.length,
      counterItemsCreated: created,
      counterItemsRepriced: repriced,
    },
  });

  revalidatePath("/admin/menu");
  revalidatePath("/admin/counter-sales/items");

  const parts = [`${days.length} meals published across ${from} to ${to}`];
  if (created > 0) parts.push(`${created} counter ${created === 1 ? "item" : "items"} added`);
  if (repriced > 0) parts.push(`${repriced} repriced`);
  return { success: `${parts.join(", ")}.` };
}
