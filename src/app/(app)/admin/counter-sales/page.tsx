import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
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
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { formatPaise, toPaise } from "@/core/money";
import { isServiceDate, serviceDateOf, toServiceDate } from "@/core/time";
import { formatServiceDate } from "@/lib/format";
import { DatePicker } from "./date-picker";
import { PaymentToggle } from "./payment-toggle";
import { pageTitle } from "@/lib/app-info";

export const metadata: Metadata = { title: pageTitle("Counter sales") };

/**
 * The day's takings from the counter.
 *
 * Revenue is the sum of FINALIZED bills whose `service_date` is the selected
 * day. Open and cancelled bills are excluded whatever their total, and payment
 * status is deliberately ignored — a finalised unpaid bill is money owed, and
 * it counts in full (spec §11).
 *
 * `service_date` rather than `finalized_at`: the column is a plain date already
 * derived in the mess's timezone, so a bill finalised at 00:30 local belongs to
 * the day the staff would say it belongs to.
 */
export default async function CounterSalesPage({
  searchParams,
}: PageProps<"/admin/counter-sales">) {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const params = await searchParams;

  const today = serviceDateOf(user.timezone, new Date());
  const requested = typeof params.date === "string" ? params.date : "";
  const date = isServiceDate(requested) ? toServiceDate(requested) : today;

  const { data, error } = await supabase
    .from("counter_bills")
    .select("id, bill_number, person_name, total_paise, payment_status, finalized_at")
    .eq("tenant_id", user.tenantId)
    .eq("status", "FINALIZED")
    .eq("service_date", date)
    .order("finalized_at", { ascending: false });

  const bills = data ?? [];
  const totalPaise = bills.reduce((sum, b) => sum + b.total_paise, 0);
  const unpaidPaise = bills
    .filter((b) => b.payment_status === "UNPAID")
    .reduce((sum, b) => sum + b.total_paise, 0);

  const timeOf = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: user.timezone,
        }).format(new Date(iso))
      : "—";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Counter sales"
        description="Walk-in bills, by the day they were finalised. Not connected to student meal plans."
        action={<DatePicker date={date} today={today} />}
      />

      <p className="text-muted-foreground text-sm">
        Managing what the counter sells?{" "}
        <Link
          href="/admin/counter-sales/items"
          className="text-primary underline underline-offset-2"
        >
          Counter items
        </Link>
        .
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Taken" value={formatPaise(toPaise(totalPaise))} />
        <StatCard label="Bills" value={String(bills.length)} />
        {/* Kept apart from the total on purpose: an owner needs to know how much
            of the day's takings is still owed, not just what was billed. */}
        <StatCard label="Still unpaid" value={formatPaise(toPaise(unpaidPaise))} />
      </div>

      {error ? (
        <TableError
          description={`The day's bills could not be loaded. ${error.message}`}
          retryHref="/admin/counter-sales"
        />
      ) : bills.length === 0 ? (
        <TableEmpty
          icon={<Receipt className="size-6" aria-hidden="true" />}
          title={`No finalised bills on ${formatServiceDate(date)}`}
          description="Bills appear here once staff finalise them at the counter. Open and cancelled bills are never counted."
        />
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs tabular-nums">{b.bill_number}</TableCell>
                  <TableCell className="font-medium">{b.person_name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm tabular-nums">
                    {timeOf(b.finalized_at)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPaise(toPaise(b.total_paise))}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={b.payment_status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <PaymentToggle billId={b.id} paymentStatus={b.payment_status} />
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
