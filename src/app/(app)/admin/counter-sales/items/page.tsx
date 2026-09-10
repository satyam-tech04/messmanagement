import type { Metadata } from "next";
import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableError, TableShell } from "@/components/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { formatPaise } from "@/core/money";
import { toPaise } from "@/core/money";
import { CreateItemDialog, EditItemDialog, ToggleItemButton } from "./item-form";
import { pageTitle } from "@/lib/app-info";

export const metadata: Metadata = { title: pageTitle("Counter items") };

export default async function CounterItemsPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("counter_items")
    .select("id, item_code, item_name, unit, price_paise, is_active")
    .eq("tenant_id", user.tenantId)
    .order("is_active", { ascending: false })
    .order("item_code");

  const items = (data ?? []).map((i) => ({
    id: i.id,
    itemCode: i.item_code,
    itemName: i.item_name,
    unit: i.unit,
    pricePaise: i.price_paise,
    isActive: i.is_active,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Counter items"
        description="What the counter can sell, and for how much. A price change never alters a bill that already exists — every bill keeps its own copy."
        action={<CreateItemDialog />}
      />

      <p className="text-muted-foreground text-sm">
        Looking for the day&apos;s takings?{" "}
        <Link href="/admin/counter-sales" className="text-primary underline underline-offset-2">
          Counter sales
        </Link>
        .
      </p>

      {error ? (
        <TableError
          description={`The item list could not be loaded. ${error.message}`}
          retryHref="/admin/counter-sales/items"
        />
      ) : items.length === 0 ? (
        <TableEmpty
          icon={<UtensilsCrossed className="size-6" aria-hidden="true" />}
          title="Nothing to sell yet"
          description="Add what the counter serves — a plate of dosa, a cup of tea — and staff can start billing for it."
          action={<CreateItemDialog />}
        />
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} className={item.isActive ? undefined : "opacity-60"}>
                  <TableCell className="font-mono text-xs tabular-nums">{item.itemCode}</TableCell>
                  <TableCell className="font-medium">{item.itemName}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{item.unit}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPaise(toPaise(item.pricePaise))}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={item.isActive ? "ACTIVE" : "INACTIVE"} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <EditItemDialog item={item} />
                      <ToggleItemButton itemId={item.id} isActive={item.isActive} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      )}
    </div>
  );
}
