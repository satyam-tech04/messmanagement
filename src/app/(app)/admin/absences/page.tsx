import type { Metadata } from "next";
import Link from "next/link";
import { CalendarOff } from "lucide-react";
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
import { eachDateInclusive, toServiceDate } from "@/core/time";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { firstRelated } from "@/infra/supabase/mappers";
import { formatServiceDate, todayIn } from "@/lib/format";
import { DecisionButtons } from "./decision-buttons";

export const metadata: Metadata = { title: "Absences · Mess OS" };

const COLUMNS = ["Student", "Days", "Meals", "Requested", "Status", ""];
const FILTERS = ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "ALL"] as const;
type Filter = (typeof FILTERS)[number];
const PAGE_SIZE = 50;

export default async function AdminAbsencesPage(props: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await props.searchParams;
  const user = await requireSessionUser();
  const supabase = await createClient();
  const today = todayIn(user.timezone);

  // Untrusted; only a whitelisted value reaches the query.
  const filter: Filter = (FILTERS as readonly string[]).includes(params.status ?? "")
    ? (params.status as Filter)
    : "PENDING";

  let query = supabase
    .from("mess_cuts")
    .select(
      `id, date_from, date_to, meal_slots, status, requested_at, rejection_reason,
       students!inner ( roll_number, profiles!inner ( full_name ) )`,
    )
    .eq("tenant_id", user.tenantId)
    .order("requested_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (filter !== "ALL") query = query.eq("status", filter);

  const { data, error } = await query;

  const rows = (data ?? []).map((row) => {
    // The generated types carry no relationships, so the embed arrives as
    // `never` and has to be named here. `firstRelated` handles the shape:
    // PostgREST returns an object for a to-one embed and an array for to-many,
    // and reading that wrong has already broken this codebase once.
    const student = firstRelated<{ roll_number: string; profiles: unknown }>(row.students as never);
    const profile = firstRelated<{ full_name: string }>(student?.profiles as never);
    return {
      id: row.id,
      dateFrom: toServiceDate(row.date_from),
      dateTo: toServiceDate(row.date_to),
      mealSlots: row.meal_slots,
      status: row.status,
      requestedAt: row.requested_at,
      rejectionReason: row.rejection_reason,
      rollNumber: student?.roll_number ?? "—",
      fullName: profile?.full_name ?? "Unknown student",
    };
  });

  // Only requests that still cover a future day matter for planning — a pending
  // one whose days have passed cannot be approved and needs clearing out.
  const pendingCount = rows.filter((r) => r.status === "PENDING").length;
  const upcomingPlates = rows
    .filter((r) => r.status === "APPROVED" && r.dateTo >= today)
    .reduce((n, r) => n + eachDateInclusive(r.dateFrom, r.dateTo).length * r.mealSlots.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Absences"
        description="Students who have marked themselves out, and away requests waiting on you."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Waiting on you"
          value={String(pendingCount)}
          hint={
            pendingCount === 0
              ? "Nothing to review."
              : "Each one is a student who does not yet know where they stand."
          }
        />
        <StatCard
          label="Meals cancelled ahead"
          value={String(upcomingPlates)}
          hint="Approved, from today onward. These are already off the headcount."
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <Button
            key={value}
            variant={filter === value ? "default" : "outline"}
            size="sm"
            render={
              <Link href={`/admin/absences?status=${value}`} className="capitalize">
                {value.toLowerCase()}
              </Link>
            }
          />
        ))}
      </div>

      {error ? (
        <TableError
          description={`Absences could not be loaded. ${error.message}`}
          retryHref="/admin/absences"
        />
      ) : rows.length === 0 ? (
        <TableEmpty
          icon={<CalendarOff className="size-6" aria-hidden="true" />}
          title={filter === "PENDING" ? "Nothing waiting" : "No absences here"}
          description={
            filter === "PENDING"
              ? "Away requests needing a decision will appear here. Students can only send them once you enable absences in Settings."
              : "Try another filter, or check that absences are enabled in Settings."
          }
          action={
            <Button
              render={<Link href="/admin/settings">Open settings</Link>}
              variant="outline"
              size="sm"
            />
          }
        />
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
                  <TableCell>
                    <span className="block font-medium">{row.fullName}</span>
                    <span className="text-muted-foreground block font-mono text-xs">
                      {row.rollNumber}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {row.dateFrom === row.dateTo
                      ? formatServiceDate(row.dateFrom)
                      : `${formatServiceDate(row.dateFrom)} — ${formatServiceDate(row.dateTo)}`}
                    <span className="text-muted-foreground block text-xs">
                      {eachDateInclusive(row.dateFrom, row.dateTo).length} day
                      {eachDateInclusive(row.dateFrom, row.dateTo).length === 1 ? "" : "s"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm capitalize">
                    {row.mealSlots.map((s) => s.toLowerCase()).join(", ")}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm tabular-nums">
                    {formatServiceDate(row.requestedAt.slice(0, 10))}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                    {row.rejectionReason ? (
                      <span className="text-muted-foreground mt-1 block max-w-48 text-xs">
                        {row.rejectionReason}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.status === "PENDING" ? (
                      <DecisionButtons id={row.id} />
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TableFooterBar
            shown={rows.length}
            total={rows.length}
            noun={filter === "ALL" ? "requests" : `${filter.toLowerCase()} requests`}
          />
        </TableShell>
      )}
    </div>
  );
}
