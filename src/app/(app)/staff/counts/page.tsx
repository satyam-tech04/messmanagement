import type { Metadata } from "next";
import { ChefHat } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableError } from "@/components/data-table";
import { serviceDateOf } from "@/core/time";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { readStaffCounts } from "@/infra/queries/staff-counts";
import { formatServiceDate } from "@/lib/format";
import { LiveCount, type SlotCount } from "../../admin/headcount/live-count";
import { pageTitle } from "@/lib/app-info";

export const metadata: Metadata = { title: pageTitle("Live count") };

/**
 * The counter's view of the same figures the admin sees.
 *
 * Deliberately just the numbers — staff need "how many left to serve" at a
 * glance while standing at the counter, not the projection breakdown.
 */
export default async function StaffCountsPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const today = serviceDateOf(user.timezone, new Date());

  // Shared with `GET /api/staff/counts`, so the web counter and the app cannot
  // disagree about a number the kitchen has already cooked to.
  const live = await readStaffCounts(supabase, user);

  if (!live) {
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

  const counts: SlotCount[] = live.slots.map((slot) => ({
    mealSlot: slot.mealSlot,
    projected: slot.projected,
    served: slot.served,
    locked: slot.locked,
  }));

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
