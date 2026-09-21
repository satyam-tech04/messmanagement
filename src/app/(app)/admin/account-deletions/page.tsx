import type { Metadata } from "next";
import Link from "next/link";
import { UserMinus } from "lucide-react";
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
import { TableEmpty, TableError, TableShell } from "@/components/data-table";
import { DELETION_WINDOW_DAYS } from "@/core/policies/account-deletion.policy";
import { requireSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseAccountDeletionRepository } from "@/infra/supabase/repositories";
import { formatServiceDate, todayIn } from "@/lib/format";
import { pageTitle } from "@/lib/app-info";
import { DecisionButtons } from "./decision-buttons";

export const metadata: Metadata = { title: pageTitle("Account deletions") };

const COLUMNS = ["Student", "Asked", "Erase by", "Status", ""];

/**
 * The deletion queue (D-32).
 *
 * A student who asks in the app is signed out immediately and lands here. The
 * mess has 30 days to erase them — a published commitment, so the deadline is
 * on screen rather than something an admin is expected to count.
 *
 * Read through the service-role repository rather than the session client:
 * completing a request rewrites rows RLS exists to protect, and the queue and
 * the action have to agree about what they are looking at.
 */
export default async function AdminAccountDeletionsPage() {
  const user = await requireSessionUser();
  const today = todayIn(user.timezone);

  let rows: Awaited<ReturnType<SupabaseAccountDeletionRepository["listByTenant"]>> = [];
  let error: string | null = null;

  try {
    rows = await new SupabaseAccountDeletionRepository(createAdminClient()).listByTenant(
      user.tenantId,
    );
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Unknown error.";
  }

  const open = rows.filter((row) => row.status === "REQUESTED");
  // Past the date we promised. Counted separately because it is the only number
  // on this screen that means somebody has to act today.
  const overdue = open.filter((row) => row.eraseBy < today);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Account deletions"
        description={`Students who asked to be deleted from the app. They are already signed out; you have ${DELETION_WINDOW_DAYS} days to erase them.`}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Waiting on you"
          value={String(open.length)}
          hint={
            open.length === 0
              ? "Nothing to erase."
              : "Each one is a student already locked out of their meals."
          }
        />
        <StatCard
          label="Past the deadline"
          value={String(overdue.length)}
          hint={
            overdue.length === 0
              ? `Every request is inside its ${DELETION_WINDOW_DAYS} days.`
              : "We told them 30 days in writing. Erase these first."
          }
        />
      </div>

      {error ? (
        <TableError
          description={`The deletion queue could not be loaded. ${error}`}
          retryHref="/admin/account-deletions"
        />
      ) : rows.length === 0 ? (
        <TableEmpty
          icon={<UserMinus className="size-6" aria-hidden="true" />}
          title="Nobody has asked to be deleted"
          description="A student can ask from the app, under their account menu. They are signed out at once and appear here for you to erase."
          action={
            <Button
              render={<Link href="/delete-account">What we promise them</Link>}
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
              {rows.map((row) => {
                const late = row.status === "REQUESTED" && row.eraseBy < today;
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className="block font-medium">{row.studentName ?? "Unknown"}</span>
                      <span className="text-muted-foreground block font-mono text-xs">
                        {row.rollNumber ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm tabular-nums">
                      {formatServiceDate(row.requestedAt.slice(0, 10))}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {formatServiceDate(row.eraseBy)}
                      {late ? (
                        <span className="text-destructive block text-xs font-medium">Overdue</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                      {row.note ? (
                        <span className="text-muted-foreground mt-1 block max-w-48 text-xs">
                          {row.note}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.status === "REQUESTED" ? (
                        <DecisionButtons id={row.id} name={row.studentName ?? "this student"} />
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          {row.decidedAt ? formatServiceDate(row.decidedAt.slice(0, 10)) : "—"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableShell>
      )}
    </div>
  );
}
