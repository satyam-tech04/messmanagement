/**
 * The counter's open bills, its catalogue, and what it has taken today.
 *
 * Shared with the web sales page. Note that open bills are a **shared pool**,
 * not per-staff: whoever is free finalises whatever is in front of them, which
 * is how a counter actually works during a rush.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDateOf } from "@/core/time";
import type { SessionUser } from "@/infra/auth/session";
import type { Database } from "@/infra/supabase/database.types";

export interface BillLine {
  readonly id: string;
  readonly counterItemId: string;
  readonly itemName: string;
  readonly unit: string | null;
  readonly unitPricePaise: number;
  readonly quantity: number;
}

export interface OpenBill {
  readonly id: string;
  readonly billNumber: string;
  readonly personName: string;
  readonly lines: readonly BillLine[];
  /** Summed from the lines. Never accumulated — totals are computed, not kept. */
  readonly totalPaise: number;
}

export interface CatalogueItem {
  readonly id: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly unit: string | null;
  readonly pricePaise: number;
}

export interface StaffSales {
  readonly serviceDate: string;
  readonly openBills: readonly OpenBill[];
  readonly catalogue: readonly CatalogueItem[];
  readonly takingsTodayPaise: number;
  readonly billsToday: number;
}

export async function readStaffSales(
  supabase: SupabaseClient<Database>,
  user: SessionUser,
): Promise<StaffSales> {
  const serviceDate = serviceDateOf(user.timezone, new Date());

  const [open, items, finalized] = await Promise.all([
    supabase
      .from("counter_bills")
      .select(
        `id, bill_number, person_name,
         counter_bill_items ( id, counter_item_id, item_name_snapshot,
                              unit_snapshot, unit_price_paise, quantity )`,
      )
      .eq("tenant_id", user.tenantId)
      .eq("status", "OPEN")
      .order("created_at", { ascending: true }),
    supabase
      .from("counter_items")
      .select("id, item_code, item_name, unit, price_paise")
      .eq("tenant_id", user.tenantId)
      .eq("is_active", true)
      .order("item_name", { ascending: true }),
    supabase
      .from("counter_bills")
      .select("total_paise")
      .eq("tenant_id", user.tenantId)
      .eq("status", "FINALIZED")
      .eq("service_date", serviceDate),
  ]);

  const openBills = (open.data ?? []).map((bill) => {
    // The generated types carry no `Relationships`, so a PostgREST embed
    // arrives as `never` and has to be named here. This one is **to-many** —
    // an array, not the object `firstRelated` unwraps.
    const rows =
      (bill.counter_bill_items as never as Array<{
        id: string;
        counter_item_id: string;
        item_name_snapshot: string;
        unit_snapshot: string | null;
        unit_price_paise: number;
        quantity: number;
      }>) ?? [];

    const lines = rows.map((line) => ({
      id: line.id,
      counterItemId: line.counter_item_id,
      // The snapshot, not the catalogue's current name or price: a price change
      // must never rewrite a bill somebody has already been quoted.
      itemName: line.item_name_snapshot,
      unit: line.unit_snapshot,
      unitPricePaise: line.unit_price_paise,
      quantity: line.quantity,
    }));

    return {
      id: bill.id,
      billNumber: bill.bill_number,
      personName: bill.person_name,
      lines,
      totalPaise: lines.reduce((sum, l) => sum + l.unitPricePaise * l.quantity, 0),
    };
  });

  return {
    serviceDate,
    openBills,
    catalogue: (items.data ?? []).map((i) => ({
      id: i.id,
      itemCode: i.item_code,
      itemName: i.item_name,
      unit: i.unit,
      pricePaise: i.price_paise,
    })),
    // Only FINALIZED counts as revenue. Payment status is a separate question
    // and must never affect what the mess has taken.
    takingsTodayPaise: (finalized.data ?? []).reduce((sum, b) => sum + (b.total_paise ?? 0), 0),
    billsToday: (finalized.data ?? []).length,
  };
}
