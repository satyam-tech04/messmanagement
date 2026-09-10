import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { TableError } from "@/components/data-table";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { serviceDateOf } from "@/core/time";
import { SalesCounter } from "./sales-counter";
import { pageTitle } from "@/lib/app-info";

export const metadata: Metadata = { title: pageTitle("Counter sales") };

/**
 * The walk-in counter.
 *
 * Every open bill is loaded, not just this staff member's: A2 makes them a
 * shared pool, because whoever is free should be able to add a plate to
 * anyone's bill without hunting for who started it.
 */
export default async function SalesPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const today = serviceDateOf(user.timezone, new Date());

  const [billsRes, itemsRes, todayRes] = await Promise.all([
    supabase
      .from("counter_bills")
      .select(
        `id, bill_number, person_name, status, payment_status,
         counter_bill_items ( id, counter_item_id, item_code_snapshot, item_name_snapshot,
                              unit_snapshot, unit_price_paise, quantity )`,
      )
      .eq("tenant_id", user.tenantId)
      .eq("status", "OPEN")
      .order("created_at", { ascending: true }),
    // Only active items are offered for new lines (spec §3). An inactive item
    // already on a bill still renders, from its own snapshot.
    supabase
      .from("counter_items")
      .select("id, item_code, item_name, unit, price_paise")
      .eq("tenant_id", user.tenantId)
      .eq("is_active", true)
      .order("item_name"),
    // Today's finalised takings, so staff can see the shift adding up without
    // leaving the screen.
    supabase
      .from("counter_bills")
      .select("total_paise")
      .eq("tenant_id", user.tenantId)
      .eq("status", "FINALIZED")
      .eq("service_date", today),
  ]);

  if (billsRes.error || itemsRes.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Counter sales" description="Bills for walk-in customers." />
        <TableError
          description={`The counter could not be loaded. ${billsRes.error?.message ?? itemsRes.error?.message}`}
          retryHref="/staff/sales"
        />
      </div>
    );
  }

  // The generated types carry no relationship metadata, so an embed comes back
  // untyped and every caller in this codebase casts it. To-many, so an array
  // even when a bill has exactly one line.
  type BillRow = {
    id: string;
    bill_number: string;
    person_name: string;
    counter_bill_items: Array<{
      id: string;
      counter_item_id: string | null;
      item_code_snapshot: string;
      item_name_snapshot: string;
      unit_snapshot: string;
      unit_price_paise: number;
      quantity: number;
    }> | null;
  };

  const bills = ((billsRes.data ?? []) as unknown as BillRow[]).map((b) => ({
    id: b.id,
    billNumber: b.bill_number,
    personName: b.person_name,
    lines: (b.counter_bill_items ?? []).map((l) => ({
      id: l.id,
      counterItemId: l.counter_item_id ?? "",
      itemCodeSnapshot: l.item_code_snapshot,
      itemNameSnapshot: l.item_name_snapshot,
      unitSnapshot: l.unit_snapshot,
      unitPricePaise: l.unit_price_paise,
      quantity: l.quantity,
    })),
  }));

  const items = (itemsRes.data ?? []).map((i) => ({
    id: i.id,
    itemCode: i.item_code,
    itemName: i.item_name,
    unit: i.unit,
    pricePaise: i.price_paise,
  }));

  const takingsToday = (todayRes.data ?? []).reduce((sum, b) => sum + b.total_paise, 0);
  const billsToday = todayRes.data?.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Counter sales"
        description="Bills for people paying at the counter. Not linked to any student's meal plan."
      />
      <SalesCounter
        bills={bills}
        items={items}
        takingsTodayPaise={takingsToday}
        billsToday={billsToday}
      />
    </div>
  );
}
