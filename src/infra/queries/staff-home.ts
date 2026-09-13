/**
 * Today's counter totals, for the staff home screen and the mobile scanner.
 *
 * Shared by both so the two cannot drift on what "served today" means — the
 * subtlety being `reversed_at`, since a reversed meal never happened and must
 * not appear in a count staff reconcile against.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_MEAL_SLOTS } from "@/core/domain/enums";
import { serviceDateOf } from "@/core/time";
import type { SessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import type { Database } from "@/infra/supabase/database.types";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";

export interface StaffHome {
  /** The mess's own day, not the device's. */
  readonly serviceDate: string;
  /**
   * The meals this mess serves, in time-of-day order. The counter shows one
   * figure per meal from this — it once hard-coded lunch and dinner, so a mess
   * serving breakfast and snacks watched those scans vanish from the screen.
   */
  readonly slots: readonly string[];
  readonly perSlot: Readonly<Record<string, number>>;
  readonly manualCount: number;
  readonly totalServed: number;
  /**
   * Which counter recorded a scan, for the audit trail.
   *
   * Derived server-side from the staff profile so two tablets signed in as
   * different people are distinguishable without any device registration — and
   * so a mobile client gets the identical label as the web without ever being
   * told the profile id it is derived from.
   */
  readonly deviceId: string;
}

export async function readStaffHome(
  supabase: SupabaseClient<Database>,
  user: SessionUser,
): Promise<StaffHome> {
  const serviceDate = serviceDateOf(user.timezone, new Date());

  const [{ data }, settings] = await Promise.all([
    supabase
      .from("attendance")
      .select("meal_slot, method")
      .eq("tenant_id", user.tenantId)
      .eq("service_date", serviceDate)
      // A reversed meal never happened.
      .is("reversed_at", null),
    new SupabaseTenantRepository(supabase, createAdminClient()).getSettings(user.tenantId),
  ]);

  const rows = data ?? [];
  const perSlot: Record<string, number> = {};
  for (const row of rows) {
    perSlot[row.meal_slot] = (perSlot[row.meal_slot] ?? 0) + 1;
  }

  return {
    serviceDate,
    slots: (settings?.mealSlots ?? [])
      .map((c) => c.slot)
      .sort((a, b) => ALL_MEAL_SLOTS.indexOf(a) - ALL_MEAL_SLOTS.indexOf(b)),
    perSlot,
    manualCount: rows.filter((r) => r.method === "MANUAL").length,
    totalServed: rows.length,
    deviceId: `counter-${user.actorProfileId.slice(0, 8)}`,
  };
}
