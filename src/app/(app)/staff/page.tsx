import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { readStaffHome } from "@/infra/queries/staff-home";
import { Scanner } from "./scanner";
import {
  LiveIndicator,
  LiveManualCount,
  LiveServedCount,
  LiveServedProvider,
} from "../admin/headcount/live-served";
import { pageTitle } from "@/lib/app-info";

export const metadata: Metadata = { title: pageTitle("Scan") };

/**
 * Counter home.
 *
 * Deliberately large targets and few words — this screen is used standing up,
 * at speed, with a queue. The counts are server-rendered so the page is useful
 * the instant it loads, before the camera has started.
 */
export default async function StaffPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();

  // Shared with `GET /api/staff/home`, so the web counter and the app can never
  // disagree about what "served today" means -- or about the device label the
  // audit trail carries.
  const home = await readStaffHome(supabase, user);

  return (
    <div className="space-y-8">
      <PageHeader title="Counter" description="Scan a student's QR code to record attendance." />

      <LiveServedProvider
        tenantId={user.tenantId}
        serviceDate={home.serviceDate}
        initialPerSlot={home.perSlot}
        initialManual={home.manualCount}
      >
        <div className="space-y-3">
          <LiveIndicator />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {/* One card per meal this mess serves — never a fixed pair. */}
            {home.slots.map((slot) => (
              <StatCard
                key={slot}
                label={`${slot.charAt(0)}${slot.slice(1).toLowerCase()} served`}
                value={<LiveServedCount slot={slot} />}
                icon={SLOT_ICONS[slot] ?? "Utensils"}
              />
            ))}
            <StatCard
              label="Manual entries"
              value={<LiveManualCount />}
              hint="Reviewed by admin"
              icon="Keyboard"
            />
          </div>
        </div>
      </LiveServedProvider>

      <Scanner deviceId={home.deviceId} timeZone={user.timezone} />
    </div>
  );
}

const SLOT_ICONS: Record<string, string> = {
  BREAKFAST: "Coffee",
  LUNCH: "Sun",
  SNACKS: "Cookie",
  DINNER: "Moon",
};
