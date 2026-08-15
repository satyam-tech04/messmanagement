import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { serviceDateOf } from "@/core/time";
import { Scanner } from "./scanner";

export const metadata: Metadata = { title: "Scan · Mess OS" };

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
  const today = serviceDateOf(user.timezone, new Date());

  const { data: served } = await supabase
    .from("attendance")
    .select("meal_slot, method")
    .eq("tenant_id", user.tenantId)
    .eq("service_date", today)
    // A reversed meal never happened.
    .is("reversed_at", null);

  const rows = served ?? [];
  const lunch = rows.filter((r) => r.meal_slot === "LUNCH").length;
  const dinner = rows.filter((r) => r.meal_slot === "DINNER").length;
  const manual = rows.filter((r) => r.method === "MANUAL").length;

  // Identifies which counter recorded a scan, for the audit trail and for
  // rate limiting. Derived from the staff profile so two tablets signed in as
  // different people are distinguishable without any device registration.
  const deviceId = `counter-${user.actorProfileId.slice(0, 8)}`;

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
