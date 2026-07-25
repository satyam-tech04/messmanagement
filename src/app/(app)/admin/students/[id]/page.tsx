import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, CalendarDays, History, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { TableEmpty, TableShell } from "@/components/data-table";
import { formatPaise, toPaise } from "@/core/money";
import { toServiceDate } from "@/core/time";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { formatDateTime, formatRelativeDay, formatServiceDate, todayIn } from "@/lib/format";
import {
  EditDetailsCard,
  ResetPasswordCard,
  StatusCard,
  type StudentDetail,
} from "./student-detail-client";

export const metadata: Metadata = { title: "Student · Mess OS" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StudentDetailPage(props: PageProps<"/admin/students/[id]">) {
  const { id } = await props.params;

  // A malformed id would make Postgres raise rather than return no rows, which
  // surfaces as a 500 instead of the 404 this actually is.
  if (!UUID.test(id)) notFound();

  const user = await requireSessionUser();
  const supabase = await createClient();

  const { data: student, error } = await supabase
    .from("students")
    .select(
      `id, roll_number, block, room_number, status, joined_at,
       profiles!inner ( full_name, phone, email, must_change_password ),
       subscriptions ( id, status, start_date, end_date, price_paise_snapshot,
                       included_meal_slots_snapshot, plans ( name ) )`,
    )
    // Tenant filter first, so another hostel's id is a 404 rather than a leak.
    .eq("tenant_id", user.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          render={<Link href="/admin/students" />}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Back to students
        </Button>
        <div className="border-destructive/30 bg-destructive/5 rounded-xl border px-6 py-16 text-center">
          <h2 className="font-semibold">Could not load this student</h2>
          <p className="text-muted-foreground mx-auto mt-1.5 max-w-md text-sm">{error.message}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            render={<a href={`/admin/students/${id}`} />}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!student) notFound();

  const profile = student.profiles as unknown as {
    full_name: string;
    phone: string | null;
    email: string | null;
    must_change_password: boolean;
  };

  const subscriptions = (student.subscriptions ?? []) as unknown as Array<{
    id: string;
    status: string;
    start_date: string;
    end_date: string;
    price_paise_snapshot: number;
    included_meal_slots_snapshot: string[];
    plans: { name: string } | null;
  }>;

  // Recent activity, so an admin answering "did he eat on Tuesday?" does not
  // have to go somewhere else to find out.
  const { data: attendance } = await supabase
    .from("attendance")
    .select("id, service_date, meal_slot, method, scanned_at")
    .eq("tenant_id", user.tenantId)
    .eq("student_id", student.id)
    .order("scanned_at", { ascending: false })
    .limit(10);

  const detail: StudentDetail = {
    id: student.id,
    rollNumber: student.roll_number,
    status: student.status as StudentDetail["status"],
    fullName: profile.full_name,
    phone: profile.phone,
    email: profile.email,
    block: student.block,
    roomNumber: student.room_number,
  };

  const today = todayIn(user.timezone);
  const active = subscriptions.find((s) => s.status === "ACTIVE");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/admin/students" />}>
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back to students
      </Button>

      <PageHeader
        title={profile.full_name}
        description={`Roll number ${student.roll_number} · joined ${formatServiceDate(
          student.joined_at?.slice(0, 10) ?? null,
        )}`}
        action={<StatusBadge status={student.status} />}
      />

      {profile.must_change_password ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-sky-500/30 bg-sky-50 px-3.5 py-3 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            This student has not yet set their own password. They will be asked to choose one the
            next time they sign in.
          </span>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Meal plan</CardTitle>
          <CardDescription>
            {active
              ? "The price and meal slots were frozen when the plan was assigned, so a later price change does not alter this subscription."
              : "Without an active plan this student cannot generate a QR code."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {subscriptions.length === 0 ? (
            <TableEmpty
              icon={<UtensilsCrossed className="size-6" aria-hidden="true" />}
              title="No plan assigned"
              description="Assign a plan so this student can be served at the counter."
              action={
                <Button variant="outline" render={<Link href="/admin/plans" />}>
                  Go to plans
                </Button>
              }
            />
          ) : (
            <TableShell>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Meals</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.plans?.name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {s.included_meal_slots_snapshot
                          .map((x) => x.charAt(0) + x.slice(1).toLowerCase())
                          .join(", ")}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {formatServiceDate(s.start_date)} — {formatServiceDate(s.end_date)}
                        {s.status === "ACTIVE" ? (
                          <span className="text-muted-foreground block text-xs">
                            {formatRelativeDay(toServiceDate(s.end_date), today, {
                              withCountdown: true,
                            })}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {formatPaise(toPaise(s.price_paise_snapshot))}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableShell>
          )}
        </CardContent>
      </Card>

      <EditDetailsCard student={detail} />
      <StatusCard student={detail} />
      <ResetPasswordCard student={detail} />

      <Card>
        <CardHeader>
          <CardTitle>Recent attendance</CardTitle>
          <CardDescription>The last 10 meals verified for this student.</CardDescription>
        </CardHeader>
        <CardContent>
          {(attendance ?? []).length === 0 ? (
            <TableEmpty
              icon={<History className="size-6" aria-hidden="true" />}
              title="No meals recorded yet"
              description="Attendance appears here as soon as this student's QR code is scanned at the counter."
            />
          ) : (
            <TableShell>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Meal</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Scanned at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(attendance ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-sm tabular-nums">
                        {formatServiceDate(a.service_date)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {a.meal_slot.charAt(0) + a.meal_slot.slice(1).toLowerCase()}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={a.method} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm tabular-nums">
                        {formatDateTime(a.scanned_at, user.timezone)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableShell>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
