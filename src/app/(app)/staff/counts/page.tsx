import type { Metadata } from "next";
import { ChefHat } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableError } from "@/components/data-table";
import { projectHeadcount } from "@/core/policies/headcount.policy";
import { serviceDateOf } from "@/core/time";
import { requireSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { createClient } from "@/infra/supabase/server";
import { createRepositories } from "@/infra/supabase/repositories";
import { formatServiceDate } from "@/lib/format";
import { LiveCount, type SlotCount } from "../../admin/headcount/live-count";

export const metadata: Metadata = { title: "Live count · Mess OS" };

/**
 * The counter's view of the same figures the admin sees.
 *
 * Deliberately just the numbers — staff need "how many left to serve" at a
 * glance while standing at the counter, not the projection breakdown.
 */
export default async function StaffCountsPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const admin = createAdminClient();
  const repos = createRepositories(supabase, admin);

  const today = serviceDateOf(user.timezone, new Date());
  const settings = await repos.tenants.getSettings(user.tenantId);

  if (!settings) {
    return (
      <div className="space-y-6">
        <PageHeader title="Live count" description="How many have been served so far." />
        <TableError
          title="Meal times are not configured"
          description="Ask the mess admin to set up meal times."
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
      .eq("service_date", today)
      // A reversed meal never happened.
      .is("reversed_at", null),
  ]);

  const servedBySlot = new Map<string, number>();
  for (const row of attendanceRes.data ?? []) {
    servedBySlot.set(row.meal_slot, (servedBySlot.get(row.meal_slot) ?? 0) + 1);
  }

  const counts: SlotCount[] = settings.mealSlots.map((config) => {
    const snapshot = snapshots.find((s) => s.mealSlot === config.slot);

    // Only a *locked* snapshot is authoritative — it is the number the kitchen
    // actually cooked to. An unlocked one is just a stale copy of something we
    // can compute right now, so preferring it would show a figure that is
    // wrong by however long ago the job last ran.
    const projected =
      snapshot?.lockedAt != null
        ? snapshot.projectedCount
        : projectHeadcount({
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live count"
        description={`Served so far today — ${formatServiceDate(today)}. Updates as you scan.`}
      />

      {counts.length === 0 ? (
        <TableEmpty
          icon={<ChefHat className="size-6" aria-hidden="true" />}
          title="No meals configured"
          description="Ask the mess admin to set up meal times."
        />
      ) : (
        <LiveCount initial={counts} tenantId={user.tenantId} serviceDate={today} />
      )}
    </div>
  );
}
