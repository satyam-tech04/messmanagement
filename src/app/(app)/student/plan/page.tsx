import type { Metadata } from "next";
import { CalendarClock, ClipboardList, UtensilsCrossed } from "lucide-react";
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
import { TableEmpty, TableError, TableShell } from "@/components/data-table";
import { formatPaise, perMealPaise, toPaise } from "@/core/money";
import { planMealsInPeriod } from "@/core/policies/plan.policy";
import { toServiceDate } from "@/core/time";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { formatRelativeDay, formatServiceDate, todayIn } from "@/lib/format";

export const metadata: Metadata = { title: "My plan · Mess OS" };

export default async function StudentPlanPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const today = todayIn(user.timezone);

  // RLS restricts these to the signed-in student's own rows; the explicit
  // tenant filter is the application-layer half of the same guarantee.
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      `id, status, start_date, end_date, price_paise_snapshot,
       included_meal_slots_snapshot, created_at,
       plans ( name, duration_days )`,
    )
    .eq("tenant_id", user.tenantId)
    .order("start_date", { ascending: false });

  const subscriptions = (data ?? []) as unknown as Array<{
    id: string;
    status: string;
    start_date: string;
    end_date: string;
    price_paise_snapshot: number;
    included_meal_slots_snapshot: string[];
    plans: { name: string; duration_days: number } | null;
  }>;

  const active = subscriptions.find((s) => s.status === "ACTIVE");
  const past = subscriptions.filter((s) => s.id !== active?.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="My plan"
        description="What you pay for, which meals it covers, and when it runs out."
      />

      {error ? (
        <TableError
          description={`Your plan could not be loaded. ${error.message}`}
          retryHref="/student/plan"
        />
      ) : !active ? (
        <TableEmpty
          icon={<UtensilsCrossed className="size-6" aria-hidden="true" />}
          title="No active plan"
          description="You need an active meal plan before you can show a QR code at the counter. Speak to the mess office to get one."
        />
      ) : (
        <Card className="border-primary/30">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{active.plans?.name ?? "Meal plan"}</CardTitle>
                <CardDescription>Your current subscription.</CardDescription>
              </div>
              <StatusBadge status={active.status} />
            </div>
          </CardHeader>
          <CardContent>
            <dl className="divide-border divide-y text-sm">
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-muted-foreground">Meals included</dt>
                <dd className="font-medium capitalize">
                  {active.included_meal_slots_snapshot.map((s) => s.toLowerCase()).join(", ")}
                </dd>
              </div>

              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-muted-foreground">Runs from</dt>
                <dd className="font-medium tabular-nums">{formatServiceDate(active.start_date)}</dd>
              </div>

              <div className="flex items-start justify-between gap-4 py-3">
                <dt className="text-muted-foreground">Valid until</dt>
                <dd className="text-right">
                  <span className="font-medium tabular-nums">
                    {formatServiceDate(active.end_date)}
                  </span>
                  {/* A countdown, because "31 Jul" alone does not tell a student
                      whether they need to pay this week. */}
                  <span className="text-muted-foreground block text-xs">
                    {formatRelativeDay(toServiceDate(active.end_date), today, {
                      withCountdown: true,
                    })}
                  </span>
                </dd>
              </div>

              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-muted-foreground">You paid</dt>
                <dd className="font-medium tabular-nums">
                  {formatPaise(toPaise(active.price_paise_snapshot))}
                </dd>
              </div>

              {active.plans ? (
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-muted-foreground">Works out at</dt>
                  <dd className="font-medium tabular-nums">
                    {formatPaise(
                      perMealPaise(
                        toPaise(active.price_paise_snapshot),
                        planMealsInPeriod(
                          active.included_meal_slots_snapshot.length,
                          active.plans.duration_days,
                        ),
                      ),
                    )}
                    <span className="text-muted-foreground font-normal"> / meal</span>
                  </dd>
                </div>
              ) : null}
            </dl>

            {/* The price is frozen — worth saying, because a student who hears
                the mess raised prices will otherwise assume they now owe more. */}
            <p className="text-muted-foreground mt-4 flex items-start gap-2 text-xs">
              <CalendarClock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              This price was fixed when your plan was assigned. If the mess changes its rates, your
              current plan is not affected.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Previous plans</CardTitle>
          <CardDescription>Everything you have been subscribed to.</CardDescription>
        </CardHeader>
        <CardContent>
          {past.length === 0 ? (
            <TableEmpty
              icon={<ClipboardList className="size-6" aria-hidden="true" />}
              title="Nothing here yet"
              description="Plans you have finished will be listed here."
            />
          ) : (
            <TableShell>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {past.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.plans?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {formatServiceDate(s.start_date)} — {formatServiceDate(s.end_date)}
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
    </div>
  );
}
