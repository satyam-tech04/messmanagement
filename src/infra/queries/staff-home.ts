/**
 * Today's counter totals, for the staff home screen and the mobile scanner.
 *
 * Shared by both so the two cannot drift on what "served today" means — the
 * subtlety being `reversed_at`, since a reversed meal never happened and must
 * not appear in a count staff reconcile against.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDateOf } from "@/core/time";
import type { SessionUser } from "@/infra/auth/session";
import type { Database } from "@/infra/supabase/database.types";

export interface StaffHome {
  /** The mess's own day, not the device's. */
  readonly serviceDate: string;
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

  const { data } = await supabase
    .from("attendance")
    .select("meal_slot, method")
    .eq("tenant_id", user.tenantId)
    .eq("service_date", serviceDate)
    // A reversed meal never happened.
    .is("reversed_at", null);

  const rows = data ?? [];
  const perSlot: Record<string, number> = {};
  for (const row of rows) {
    perSlot[row.meal_slot] = (perSlot[row.meal_slot] ?? 0) + 1;
  }

  return {
    serviceDate,
    perSlot,
    manualCount: rows.filter((r) => r.method === "MANUAL").length,
    totalServed: rows.length,
    deviceId: `counter-${user.actorProfileId.slice(0, 8)}`,
  };
}
