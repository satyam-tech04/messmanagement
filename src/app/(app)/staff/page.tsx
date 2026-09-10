import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { readStaffHome } from "@/infra/queries/staff-home";
import { Scanner } from "./scanner";
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
  const lunch = home.perSlot.LUNCH ?? 0;
  const dinner = home.perSlot.DINNER ?? 0;
  const manual = home.manualCount;
  const deviceId = home.deviceId;

  return (
    <div className="space-y-8">
      <PageHeader title="Counter" description="Scan a student's QR code to record attendance." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Lunch served" value={lunch} icon="Sun" />
        <StatCard label="Dinner served" value={dinner} icon="Moon" />
        <StatCard
          label="Manual entries"
          value={manual}
          hint={manual > 0 ? "Reviewed by admin" : "None today"}
          icon="Keyboard"
          tone={manual > 0 ? "warning" : "default"}
        />
      </div>

      <Scanner deviceId={deviceId} timeZone={user.timezone} />
    </div>
  );
}
