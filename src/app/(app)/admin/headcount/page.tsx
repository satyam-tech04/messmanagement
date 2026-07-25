import type { Metadata } from "next";
import { ChefHat } from "lucide-react";
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
import { TableEmpty, TableError, TableShell } from "@/components/data-table";
import { projectHeadcount } from "@/core/policies/headcount.policy";
import { serviceDateOf } from "@/core/time";
import { requireSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { createClient } from "@/infra/supabase/server";
import { createRepositories } from "@/infra/supabase/repositories";
import { formatServiceDate } from "@/lib/format";
import { LiveCount, type SlotCount } from "./live-count";

export const metadata: Metadata = { title: "Headcount · Mess OS" };

export default async function HeadcountPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const admin = createAdminClient();
  const repos = createRepositories(supabase, admin);

  const today = serviceDateOf(user.timezone, new Date());

  const settings = await repos.tenants.getSettings(user.tenantId);
  if (!settings) {
    return (
      <div className="space-y-6">
        <PageHeader title="Headcount" description="How many plates to cook." />
        <TableError
          title="Meal times are not configured"
          description="This mess has no meal slots set up, so there is nothing to project against."
        />
      </div>
    );
  }

  const [snapshots, subscribers, cuts, attendanceRes] = await Promise.all([
    repos.headcountSnapshots.findForDate(user.tenantId, today),
    repos.subscriptions.findActiveCovering(user.tenantId, today),
    repos.messCuts.findCoveringDate(user.tenantId, today),
    supabase
      .from("attendance")
      .select("meal_slot")
      .eq("tenant_id", user.tenantId)
      .eq("service_date", today),
  ]);

  const servedBySlot = new Map<string, number>();
  for (const row of attendanceRes.data ?? []) {
    servedBySlot.set(row.meal_slot, (servedBySlot.get(row.meal_slot) ?? 0) + 1);
  }

  const counts: SlotCount[] = settings.mealSlots.map((config) => {
    const snapshot = snapshots.find((s) => s.mealSlot === config.slot);

    // The snapshot is what the kitchen cooked to. Without one — the cron has
    // not run yet — project live so the screen is still useful, rather than
    // showing a zero that reads as "nobody is eating".
    const projected =
      snapshot?.projectedCount ??
      projectHeadcount({
        serviceDate: today,
        mealSlot: config.slot,
        subscribers,
        messCuts: cuts,
      }).projectedCount;

    return {
      mealSlot: config.slot,
      projected,
      served: servedBySlot.get(config.slot) ?? 0,
      locked: Boolean(snapshot?.lockedAt),
    };
  });

  // The breakdown is what makes the number defensible when an owner asks why
  // the kitchen was told to cook 247.
  const breakdowns = settings.mealSlots.map((config) => ({
    slot: config.slot,
    window: `${config.start}–${config.end}`,
    ...projectHeadcount({
      serviceDate: today,
      mealSlot: config.slot,
      subscribers,
      messCuts: cuts,
    }).breakdown,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Headcount"
        description={`How many plates to cook, and how many have actually been served. ${formatServiceDate(today)}.`}
      />

      {counts.length === 0 ? (
        <TableEmpty
          icon={<ChefHat className="size-6" aria-hidden="true" />}
          title="No meals configured"
          description="Set up this mess's meal times before a headcount can be projected."
        />
      ) : (
        <>
          <LiveCount initial={counts} tenantId={user.tenantId} serviceDate={today} />

          <Card>
            <CardHeader>
              <CardTitle>How the projection is calculated</CardTitle>
              <CardDescription>
                Blocked students are excluded — they cannot be served, so cooking for them wastes
                food. Students in their grace period are still counted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TableShell>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Meal</TableHead>
                      <TableHead>Window</TableHead>
                      <TableHead className="text-right">Eligible</TableHead>
                      <TableHead className="text-right">On mess cut</TableHead>
                      <TableHead className="text-right">Plates</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {breakdowns.map((b) => (
                      <TableRow key={b.slot}>
                        <TableCell className="font-medium capitalize">
                          {b.slot.toLowerCase()}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm tabular-nums">
                          {b.window}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.eligibleSubscribers}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {b.onMessCut > 0 ? `−${b.onMessCut}` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {b.eligibleSubscribers - b.onMessCut}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableShell>

              {snapshots.length === 0 ? (
                <p className="text-muted-foreground mt-3 text-xs">
                  No snapshot has been taken for today yet, so these are live figures. The scheduled
                  job locks the count before each meal.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
