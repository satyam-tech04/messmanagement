import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { TableEmpty, TableError, TableShell } from "@/components/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { daysUsedInMonth, earliestAbsenceDate } from "@/core/policies/absence.policy";
import { subscriptionStateOf } from "@/core/policies/subscription-state";
import { toServiceDate } from "@/core/time";
import { requireSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { createClient } from "@/infra/supabase/server";
import { SupabaseMessCutRepository, SupabaseTenantRepository } from "@/infra/supabase/repositories";
import { formatServiceDate, todayIn } from "@/lib/format";
import { AbsenceForm } from "./absence-form";
import { CancelButton } from "./cancel-button";

export const metadata: Metadata = { title: "Absences · Mess OS" };

export default async function StudentAbsencesPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const admin = createAdminClient();
  const today = todayIn(user.timezone);

  const settings = await new SupabaseTenantRepository(supabase, admin).getSettings(user.tenantId);

  if (!settings) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="Absences" description="Marking yourself out of meals." />
        <TableError
          title="This page could not be loaded"
          description="The mess's settings are unavailable. Try again, or speak to the mess office."
          retryHref="/student/absences"
        />
      </div>
    );
  }

  // The nav hides the link when both toggles are off; this is the other half of
  // that gate. A student who bookmarked the URL, or whose mess turned the
  // feature off yesterday, must not land on a form that only leads to a refusal.
  if (!settings.allowMealSkipping && !settings.allowAwayRequests) notFound();

  if (!user.studentId) notFound();
  const studentId = user.studentId;

  const cuts = new SupabaseMessCutRepository(admin);
  const [{ data: subscriptions }, history, live] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("id, status, start_date, end_date, included_meal_slots_snapshot")
      .eq("tenant_id", user.tenantId)
      .order("start_date", { ascending: false }),
    cuts.findForStudent(user.tenantId, studentId, 50),
    cuts.findLiveInMonth(user.tenantId, studentId, today),
  ]);

  // Derived from the dates, not the status column — nothing marks a finished
  // plan EXPIRED, so trusting the column would offer to cut meals on a plan
  // that ran out in July.
  const active = (subscriptions ?? []).find(
    (s) =>
      subscriptionStateOf(
        {
          status: s.status,
          startDate: toServiceDate(s.start_date),
          endDate: toServiceDate(s.end_date),
        },
        today,
      ) === "RUNNING",
  );

  const daysUsed = daysUsedInMonth(live, today);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Absences"
        description="Tell the kitchen when you will not be eating, so they do not cook for you."
      />

      {!active ? (
        <TableEmpty
          icon={<CalendarOff className="size-6" aria-hidden="true" />}
          title="No active plan"
          description="You need a running meal plan before you can mark yourself out of anything. Speak to the mess office."
        />
      ) : (
        <AbsenceForm
          allowMealSkipping={settings.allowMealSkipping}
          allowPartialDaySkip={settings.allowPartialDaySkip}
          allowAwayRequests={settings.allowAwayRequests}
          awayRequiresApproval={settings.awayRequiresApproval}
          cutMaxDaysPerMonth={settings.cutMaxDaysPerMonth}
          daysUsedThisMonth={daysUsed}
          awayMaxDays={settings.awayMaxDays}
          plannedSlots={active.included_meal_slots_snapshot}
          // The same function the policy applies on submit, so the picker can
          // never offer a date the server will refuse for notice.
          earliestSkipDate={earliestAbsenceDate(today, settings.cutAdvanceHours)}
          earliestAwayDate={earliestAbsenceDate(today, settings.awayAdvanceHours)}
          planEndDate={active.end_date}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your absences</CardTitle>
          <CardDescription>
            Everything you have asked for. Withdraw one and you are expected at those meals again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <TableEmpty
              icon={<CalendarOff className="size-6" aria-hidden="true" />}
              title="Nothing yet"
              description="Meals you skip and periods you are away will be listed here."
            />
          ) : (
            <TableShell>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Days</TableHead>
                    <TableHead>Meals</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-sm tabular-nums">
                        {row.dateFrom === row.dateTo
                          ? formatServiceDate(row.dateFrom)
                          : `${formatServiceDate(row.dateFrom)} — ${formatServiceDate(row.dateTo)}`}
                      </TableCell>
                      <TableCell className="text-sm capitalize">
                        {row.mealSlots.map((s) => s.toLowerCase()).join(", ")}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                        {row.rejectionReason ? (
                          <span className="text-muted-foreground mt-1 block text-xs">
                            {row.rejectionReason}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Only a request that has not been acted on can be
                            withdrawn. A rejected one is the office's decision. */}
                        {row.status === "PENDING" || row.status === "APPROVED" ? (
                          <CancelButton id={row.id} />
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
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
