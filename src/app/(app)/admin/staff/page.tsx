import type { Metadata } from "next";
import { UserCog } from "lucide-react";
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
import { serviceDateOf } from "@/core/time";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { formatServiceDate } from "@/lib/format";
import { pageTitle } from "@/lib/app-info";
import { AddStaffDialog, ResetStaffPasswordButton } from "./staff-form";

export const metadata: Metadata = { title: pageTitle("Staff") };

const COLUMNS = ["Name", "Email", "Phone", "Added", "Status", ""];

export default async function StaffPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();

  // RLS (`profiles_read_tenant`) already scopes this to the caller's own mess;
  // the tenant filter is the application layer saying the same thing (rule 8).
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, status, must_change_password, created_at")
    .eq("tenant_id", user.tenantId)
    .eq("role", "STAFF")
    .order("created_at", { ascending: true });

  const staff = data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        description="Counter logins. Staff scan meal codes, record manual entries and run counter sales — they cannot change students, plans or settings."
        action={<AddStaffDialog />}
      />

      {error ? (
        <TableError
          description={`The staff list could not be loaded. ${error.message}`}
          retryHref="/admin/staff"
        />
      ) : staff.length === 0 ? (
        <TableEmpty
          icon={<UserCog className="size-6" aria-hidden="true" />}
          title="No staff logins yet"
          description="Create one for whoever works the counter. They get a temporary password to hand over, and choose their own the first time they sign in."
          action={<AddStaffDialog />}
        />
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
              {staff.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">{member.full_name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm break-all">
                    {member.email ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm tabular-nums">
                    {member.phone ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {/* The mess's own day, not UTC's: a login created at 23:00
                        IST would otherwise be dated to the day before. */}
                    {formatServiceDate(serviceDateOf(user.timezone, new Date(member.created_at)))}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={member.status} />
                      {/* Worth showing: until they sign in and choose their own,
                          the password the admin handed over still works. */}
                      {member.must_change_password ? (
                        <StatusBadge status="Password not changed" tone="warning" />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <ResetStaffPasswordButton profileId={member.id} fullName={member.full_name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TableFooterBar
            shown={staff.length}
            total={staff.length}
            noun={staff.length === 1 ? "staff login" : "staff logins"}
          />
        </TableShell>
      )}
    </div>
  );
}
