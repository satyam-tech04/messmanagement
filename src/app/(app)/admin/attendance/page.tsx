import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { TableEmpty, TableError, TableFooterBar, TableShell } from "@/components/data-table";
import { addDays, serviceDateOf, toServiceDate } from "@/core/time";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { formatDateTime, formatServiceDate } from "@/lib/format";
import { firstRelated } from "@/infra/supabase/mappers";

export const metadata: Metadata = { title: "Attendance · Mess OS" };

const COLUMNS = ["Roll number", "Name", "Meal", "Method", "Scanned at", "Reason"];
const VALID_SLOTS = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"] as const;
const VALID_METHODS = ["QR", "MANUAL", "RFID"] as const;

function parseOne<T extends string>(raw: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

export default async function AttendancePage(props: {
  searchParams: Promise<{ date?: string; slot?: string; method?: string }>;
}) {
  const params = await props.searchParams;
  const user = await requireSessionUser();
  const supabase = await createClient();

  const today = serviceDateOf(user.timezone, new Date());
  // Query-string values are untrusted; only whitelisted ones reach the database.
  const date =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? toServiceDate(params.date) : today;
  const slot = parseOne(params.slot ?? "", VALID_SLOTS);
  const method = parseOne(params.method ?? "", VALID_METHODS);

  let query = supabase
    .from("attendance")
    .select(
      `id, service_date, meal_slot, method, scanned_at, override_reason,
       students!inner ( roll_number, profiles!inner ( full_name ) )`,
      { count: "exact" },
    )
    .eq("tenant_id", user.tenantId)
    .eq("service_date", date);

  if (slot) query = query.eq("meal_slot", slot);
  if (method) query = query.eq("method", method);

  const { data, count, error } = await query.order("scanned_at", { ascending: false }).limit(500);

  const rows = (data ?? []).map((r) => {
    const student = firstRelated<{ roll_number: string; profiles: unknown }>(r.students as never);
    const profile = firstRelated<{ full_name: string }>(student?.profiles as never);
    return {
      id: r.id,
      rollNumber: student?.roll_number ?? "—",
      fullName: profile?.full_name ?? "—",
      mealSlot: r.meal_slot,
      method: r.method,
      scannedAt: r.scanned_at,
      reason: r.override_reason,
    };
  });

  const manualCount = rows.filter((r) => r.method === "MANUAL").length;
  const hasFilters = Boolean(slot || method);

  const linkFor = (next: Partial<{ date: string; slot: string; method: string }>) => {
    const search = new URLSearchParams({
      date,
      ...(slot ? { slot } : {}),
      ...(method ? { method } : {}),
      ...next,
    });
    return `/admin/attendance?${search}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Every meal recorded at the counter. Manual entries are highlighted — they are the ones worth reviewing."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              render={<Link href={linkFor({ date: addDays(date, -1) })} />}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              <span className="sr-only">Previous day</span>
            </Button>
            {date !== today ? (
              <Button variant="outline" size="sm" render={<Link href="/admin/attendance" />}>
                Today
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={date >= today}
              render={<Link href={linkFor({ date: addDays(date, 1) })} />}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
              <span className="sr-only">Next day</span>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Meals served" value={count ?? 0} icon="UtensilsCrossed" />
        <StatCard
          label="Manual entries"
          value={manualCount}
          hint={manualCount > 0 ? "Each has a recorded reason" : "None on this day"}
          icon="Keyboard"
          tone={manualCount > 0 ? "warning" : "default"}
        />
        <StatCard label="Service date" value={formatServiceDate(date)} icon="CalendarDays" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={!slot && !method ? "default" : "outline"}
          size="sm"
          render={<Link href={`/admin/attendance?date=${date}`} />}
        >
          All
        </Button>
        {VALID_SLOTS.map((s) => (
          <Button
            key={s}
            variant={slot === s ? "default" : "outline"}
            size="sm"
            className="capitalize"
            render={<Link href={linkFor({ slot: s })} />}
          >
            {s.toLowerCase()}
          </Button>
        ))}
        <Button
          variant={method === "MANUAL" ? "default" : "outline"}
          size="sm"
          render={<Link href={linkFor({ method: "MANUAL" })} />}
        >
          Manual only
        </Button>
      </div>

      {error ? (
        <TableError
          description={`Attendance could not be loaded. ${error.message}`}
          retryHref="/admin/attendance"
        />
      ) : rows.length === 0 ? (
        hasFilters ? (
          <TableEmpty
            title="Nothing matches these filters"
            description="Try a different meal, or clear the filters to see the whole day."
            action={
              <Button variant="outline" render={<Link href={`/admin/attendance?date=${date}`} />}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <TableEmpty
            icon={<ScanLine className="size-6" aria-hidden="true" />}
            title={`No meals recorded on ${formatServiceDate(date)}`}
            description="Attendance appears here as soon as staff start scanning at the counter."
          />
        )
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((c) => (
                  <TableHead key={c}>{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-sm font-medium">{row.rollNumber}</TableCell>
                  <TableCell>{row.fullName}</TableCell>
                  <TableCell className="text-sm capitalize">{row.mealSlot.toLowerCase()}</TableCell>
                  <TableCell>
                    <StatusBadge status={row.method} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm tabular-nums">
                    {formatDateTime(row.scannedAt, user.timezone)}
                  </TableCell>
                  {/* Only manual entries carry one, and it is the whole reason
                      they are auditable. */}
                  <TableCell className="text-muted-foreground max-w-xs truncate text-sm">
                    {row.reason ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <TableFooterBar shown={rows.length} total={count ?? rows.length} noun="meals" />
        </TableShell>
      )}
    </div>
  );
}
