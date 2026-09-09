/**
 * The next few days of meals, as the student sees them.
 *
 * Shared by the web page and `GET /api/student/menu` so the two cannot drift on
 * the part that is easy to get wrong: which day is "today". That is the mess's
 * day, derived in its own timezone — never the device's, and never
 * `toISOString().slice(0, 10)`.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveServiceState } from "@/core/policies/menu.policy";
import { addDays, eachDateInclusive, serviceDateOf } from "@/core/time";
import type { SessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";
import type { Database } from "@/infra/supabase/database.types";

/** Today plus three. Far enough to plan around, short enough to stay honest. */
const DAYS_AHEAD = 3;

export interface MenuSlot {
  readonly mealSlot: string;
  readonly label: string;
  /** Wall-clock window in the mess's timezone, e.g. "12:30–14:00". */
  readonly window: string | null;
  readonly items: readonly string[];
  readonly notes: string | null;
  /** True for the meal being served right now. */
  readonly servingNow: boolean;
}

export interface MenuDay {
  readonly serviceDate: string;
  readonly isToday: boolean;
  readonly slots: readonly MenuSlot[];
}

export interface StudentMenu {
  readonly today: string;
  readonly days: readonly MenuDay[];
}

export async function readStudentMenu(
  supabase: SupabaseClient<Database>,
  user: SessionUser,
): Promise<StudentMenu> {
  const settings = await new SupabaseTenantRepository(supabase, createAdminClient()).getSettings(
    user.tenantId,
  );

  const today = serviceDateOf(user.timezone, new Date());
  const to = addDays(today, DAYS_AHEAD);

  const { data } = await supabase
    .from("menus")
    .select("service_date, meal_slot, items, notes")
    .eq("tenant_id", user.tenantId)
    .gte("service_date", today)
    .lte("service_date", to)
    .order("service_date", { ascending: true });

  const byKey = new Map<string, { items: string[]; notes: string | null }>();
  for (const row of data ?? []) {
    byKey.set(`${row.service_date}|${row.meal_slot}`, {
      items: (row.items as string[]) ?? [],
      notes: row.notes,
    });
  }

  const state = settings
    ? resolveServiceState({
        timeZone: user.timezone,
        now: new Date(),
        slots: settings.mealSlots,
      })
    : undefined;

  const slots = settings?.mealSlots ?? [];

  return {
    today,
    days: eachDateInclusive(today, to).map((date) => ({
      serviceDate: date,
      isToday: date === today,
      slots: slots.map((slot) => {
        const menu = byKey.get(`${date}|${slot.slot}`);
        return {
          mealSlot: slot.slot,
          label: slot.slot.charAt(0) + slot.slot.slice(1).toLowerCase(),
          window: `${slot.start}–${slot.end}`,
          items: menu?.items ?? [],
          notes: menu?.notes ?? null,
          // `current` is the meal open right now, and only ever belongs to
          // today — a window cannot be open on a date that has not arrived.
          servingNow: date === today && state?.current?.slot === slot.slot,
        };
      }),
    })),
  };
}
