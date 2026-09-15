import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  OPERATOR_STUDENT_LIMIT,
  readOperatorStudents,
  type OperatorStudentList,
} from "@/infra/queries/operator-students";
import { EnterAsStudentButton } from "./enter-button";
import { pageTitle } from "@/lib/app-info";

export const metadata: Metadata = { title: pageTitle("Enter as a student") };
export const dynamic = "force-dynamic";

const STUDENT_PICKER_COLUMNS = ["Roll number", "Name", "Room", "Enrolment", ""] as const;

export default async function OperatorStudentsPage(props: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await props.searchParams;
  const user = await requireSessionUser();
  const supabase = await createClient();

  let list: OperatorStudentList | null = null;
  let loadError: string | null = null;
  try {
    list = await readOperatorStudents(supabase, user.tenantId, q);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "The student list could not be read.";
  }

  const term = q.trim();

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href="/superuser" />}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        All personas
      </Button>

      <PageHeader
        title="Enter as a student"
        description={`Students of ${user.tenantName}. Pick one to see their QR, menu and plan exactly as they do. To enter a student in another mess, change mess first.`}
      />

      <form role="search" className="flex max-w-md gap-2">
        <div className="relative flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            name="q"
            defaultValue={term}
            placeholder="Name or roll number"
            aria-label="Search students"
            className="bg-card h-10 pl-9"
          />
        </div>
        <Button type="submit" variant="outline" className="h-10">
          Search
        </Button>
      </form>

      {loadError ? (
        <TableError
          description={`Students could not be loaded. ${loadError}`}
          retryHref={`/superuser/students${term ? `?q=${encodeURIComponent(term)}` : ""}`}
        />
      ) : !list || list.rows.length === 0 ? (
        term ? (
          <TableEmpty
            icon={<Search className="size-6" aria-hidden="true" />}
            title={`No student matches “${term}”`}
            description="Search by part of a name or a roll number."
            action={
              <Button variant="outline" size="sm" render={<Link href="/superuser/students" />}>
                Clear search
              </Button>
            }
          />
        ) : (
          <TableEmpty
            icon={<Users className="size-6" aria-hidden="true" />}
            title={`${user.tenantName} has no students yet`}
            description="Enrol a student as the mess admin first, or change to a mess that has some."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" render={<Link href="/admin/students/new" />}>
                  Add a student
                </Button>
                <Button variant="outline" size="sm" render={<Link href="/admin/messes" />}>
                  Change mess
                </Button>
              </div>
            }
          />
        )
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                {STUDENT_PICKER_COLUMNS.map((c, i) => (
                  <TableHead key={c || i} className={c ? undefined : "w-0"}>
                    {c || <span className="sr-only">Actions</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((s) => (
                <TableRow key={s.profileId}>
                  <TableCell className="font-mono text-sm">{s.rollNumber}</TableCell>
                  <TableCell className="font-medium">{s.fullName}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{s.room ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      {s.accountEnabled ? (
                        <EnterAsStudentButton
                          profileId={s.profileId}
                          fullName={s.fullName}
                          rollNumber={s.rollNumber}
                          tenantName={user.tenantName}
                        />
                      ) : (
                        <span className="text-muted-foreground text-sm whitespace-nowrap">
                          Account disabled
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TableFooterBar
            shown={list.rows.length}
            total={list.total}
            noun={list.total === 1 ? "student" : "students"}
          >
            {list.total > OPERATOR_STUDENT_LIMIT ? (
              <span className="text-xs">Search to narrow the list</span>
            ) : null}
          </TableFooterBar>
        </TableShell>
      )}
    </div>
  );
}
