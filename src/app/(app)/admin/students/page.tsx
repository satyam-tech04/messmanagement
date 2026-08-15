import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileUp, Plus, Users } from "lucide-react";
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
import { StatusBadge } from "@/components/status-badge";
import { TableEmpty, TableError, TableFooterBar, TableShell } from "@/components/data-table";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { formatServiceDate } from "@/lib/format";
import { subscriptionStateOf } from "@/core/policies/subscription-state";
import { serviceDateOf, toServiceDate } from "@/core/time";
import { StudentsFilters } from "./students-filters";

export const metadata: Metadata = { title: "Students · Mess OS" };

const PAGE_SIZE = 25;
// "Meal plan" and "Account", not "Plan" and "Status". Both used to read as
// bare status words sitting side by side, so a row showing "Expired" next to
// "Active" looked self-contradictory — the first is the subscription, the
// second is whether the student is still enrolled. Naming what each describes
// is the whole fix.
const COLUMNS = ["Roll number", "Name", "Room", "Meal plan", "Account", ""] as const;

/** Query-string status is untrusted input; only these values may reach the DB. */
const VALID_STATUSES = ["ACTIVE", "GRACE", "BLOCKED", "INACTIVE"] as const;
type StudentStatusFilter = (typeof VALID_STATUSES)[number];

function parseStatus(raw: string): StudentStatusFilter | null {
  return (VALID_STATUSES as readonly string[]).includes(raw) ? (raw as StudentStatusFilter) : null;
}

export default async function StudentsPage(props: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { q = "", status: rawStatus = "", page: pageParam } = await props.searchParams;
  const status = parseStatus(rawStatus);
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const user = await requireSessionUser();
  const supabase = await createClient();

  const term = q.trim();

  /**
   * Name lives on `profiles`, roll number on `students`, and PostgREST cannot
   * express OR across a parent and an embedded table in one filter. So resolve
   * matching profile ids first, then OR against them.
   *
   * Two round trips, but both are indexed and tenant-scoped, and it keeps the
   * search doing what the placeholder promises. The alternative — a denormalised
   * search column — is worth revisiting only if this becomes slow at scale.
   */
  let matchingProfileIds: string[] = [];
  if (term) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id")
      .eq("tenant_id", user.tenantId)
      .eq("role", "STUDENT")
      .ilike("full_name", `%${term}%`)
      .limit(500);
    matchingProfileIds = (profiles ?? []).map((p) => p.id);
  }

  let query = supabase
    .from("students")
    .select(
      `id, roll_number, block, room_number, status, joined_at,
       profiles!inner ( full_name, phone ),
       subscriptions ( status, start_date, end_date )`,
      { count: "exact" },
    )
    // Explicit tenant filter even though RLS enforces it — the application
    // layer is the primary guard, RLS the backstop (§5.1).
    .eq("tenant_id", user.tenantId);

  if (status) query = query.eq("status", status);
  if (term) {
    const escaped = term.replace(/[,()]/g, "");
    const clauses = [`roll_number.ilike.%${escaped}%`];
    if (matchingProfileIds.length > 0) {
      clauses.push(`profile_id.in.(${matchingProfileIds.join(",")})`);
    }
    query = query.or(clauses.join(","));
  }

  const today = serviceDateOf(user.timezone, new Date());

  const { data, count, error } = await query
    .order("roll_number", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(term || status);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Everyone enrolled in the mess. Add a student to issue their login and QR access."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* A real anchor for the export: it is a route handler returning a
                file, and client navigation would try to render the CSV. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <Button variant="outline" size="sm" render={<a href="/admin/students/export" />}>
              <Download className="size-4" aria-hidden="true" />
              Export
            </Button>
            <Button variant="outline" size="sm" render={<Link href="/admin/students/import" />}>
              <FileUp className="size-4" aria-hidden="true" />
              Import
            </Button>
            <Button render={<Link href="/admin/students/new" />}>
              <Plus className="size-4" aria-hidden="true" />
              Add student
            </Button>
          </div>
        }
      />

      <StudentsFilters initialQuery={q} initialStatus={status ?? ""} />

      {error ? (
        <TableError
          description={`The student list could not be loaded. ${error.message}`}
          retryHref="/admin/students"
        />
      ) : total === 0 ? (
        hasFilters ? (
          <TableEmpty
            title="No students match these filters"
            description="Try a different search term, or clear the status filter to see everyone."
            action={
              <Button variant="outline" render={<Link href="/admin/students" />}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <TableEmpty
            icon={<Users className="size-6" aria-hidden="true" />}
            title="No students yet"
            description="Add your first student to issue their login details. They can show a QR code at the counter as soon as they have an active plan."
            action={
              <Button render={<Link href="/admin/students/new" />}>
                <Plus className="size-4" aria-hidden="true" />
                Add your first student
              </Button>
            }
          />
        )
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((c, i) => (
                  <TableHead key={c || i} className={i === COLUMNS.length - 1 ? "w-0" : undefined}>
                    {c || <span className="sr-only">Actions</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((s) => {
                const profile = s.profiles as unknown as {
                  full_name: string;
                  phone: string | null;
                } | null;
                const subs = (s.subscriptions ?? []) as unknown as Array<{
                  status: string;
                  start_date: string;
                  end_date: string;
                }>;
                // Judge by the dates: nothing marks a finished plan EXPIRED
                // yet, so the status column alone would label a plan that ended
                // weeks ago as "Active until 31 Jul".
                const activeRow = subs.find((x) => x.status === "ACTIVE");
                const state = activeRow
                  ? subscriptionStateOf(
                      {
                        status: activeRow.status,
                        startDate: toServiceDate(activeRow.start_date),
                        endDate: toServiceDate(activeRow.end_date),
                      },
                      today,
                    )
                  : null;
                const active = state === "RUNNING" ? activeRow : undefined;
                const lapsed = state === "EXPIRED" || state === "SCHEDULED" ? activeRow : undefined;

                return (
                  <TableRow key={s.id}>
                    {/* Monospace: roll numbers are read aloud and compared by
                        eye, so digit alignment and a slashed zero matter. */}
                    <TableCell className="font-mono text-sm font-medium">{s.roll_number}</TableCell>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{profile?.full_name ?? "—"}</p>
                        {profile?.phone ? (
                          <p className="text-muted-foreground truncate text-xs">{profile.phone}</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {s.block || s.room_number
                        ? `${s.block ?? ""}${s.block && s.room_number ? " · " : ""}${s.room_number ?? ""}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {/* A badge, not coloured text. The one question an admin
                          has scanning this list is "can this student eat
                          today?", and a lapsed plan is the answer being no —
                          which deserves the same visual weight as any other
                          blocking state, plus the action that fixes it. */}
                      {active ? (
                        <span className="text-sm">
                          <StatusBadge status="COVERED" />
                          <span className="text-muted-foreground mt-1 block text-xs tabular-nums">
                            until {formatServiceDate(active.end_date)}
                          </span>
                        </span>
                      ) : lapsed ? (
                        <span className="text-sm">
                          <StatusBadge status={state === "SCHEDULED" ? "STARTS LATER" : "LAPSED"} />
                          <span className="text-muted-foreground mt-1 block text-xs tabular-nums">
                            {state === "SCHEDULED"
                              ? `from ${formatServiceDate(lapsed.start_date)}`
                              : `ended ${formatServiceDate(lapsed.end_date)} · renew to serve`}
                          </span>
                        </span>
                      ) : (
                        <span className="text-sm">
                          <StatusBadge status="NO PLAN" />
                          <span className="text-muted-foreground mt-1 block text-xs">
                            assign one to serve
                          </span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        render={<Link href={`/admin/students/${s.id}`} />}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <TableFooterBar shown={data?.length ?? 0} total={total} noun="students">
            {totalPages > 1 ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  render={
                    <Link
                      href={`/admin/students?${new URLSearchParams({
                        ...(q ? { q } : {}),
                        ...(status ? { status } : {}),
                        page: String(page - 1),
                      })}`}
                    />
                  }
                >
                  Previous
                </Button>
                <span className="text-xs tabular-nums">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  render={
                    <Link
                      href={`/admin/students?${new URLSearchParams({
                        ...(q ? { q } : {}),
                        ...(status ? { status } : {}),
                        page: String(page + 1),
                      })}`}
                    />
                  }
                >
                  Next
                </Button>
              </>
            ) : null}
          </TableFooterBar>
        </TableShell>
      )}
    </div>
  );
}
