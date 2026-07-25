import type { Metadata } from "next";
import Link from "next/link";
import { Keyboard, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { serviceDateOf } from "@/core/time";

export const metadata: Metadata = { title: "Scan · Mess OS" };

/**
 * Counter home.
 *
 * The scanner itself lands in Phase 1.6b; this is the shell around it, and it
 * already shows the live-to-date counts staff need. Deliberately large targets
 * and few words — this screen is used standing up, at speed, with a queue.
 */
export default async function StaffPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const today = serviceDateOf(user.timezone, new Date());

  const { data: served } = await supabase
    .from("attendance")
    .select("meal_slot, method")
    .eq("tenant_id", user.tenantId)
    .eq("service_date", today);

  const rows = served ?? [];
  const lunch = rows.filter((r) => r.meal_slot === "LUNCH").length;
  const dinner = rows.filter((r) => r.meal_slot === "DINNER").length;
  const manual = rows.filter((r) => r.method === "MANUAL").length;

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

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-primary/30">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="bg-primary/10 text-primary flex size-16 items-center justify-center rounded-2xl">
              <ScanLine className="size-8" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">Scan QR</h2>
              <p className="text-muted-foreground text-sm">
                The fastest path. Point the camera at the student&apos;s screen.
              </p>
            </div>
            {/* Deliberately disabled rather than hidden: staff should see the
                primary action exists and is coming, not wonder where it went. */}
            <Button size="lg" className="h-12 w-full max-w-xs text-base" disabled>
              Scanner arrives in Phase 1
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
              <Keyboard className="size-8" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">Manual entry</h2>
              <p className="text-muted-foreground text-sm">
                Phone dead or camera failing? Look the student up by roll number.
              </p>
            </div>
            <Button
              render={<Link href="/staff/manual" />}
              size="lg"
              variant="outline"
              className="h-12 w-full max-w-xs text-base"
            >
              Enter by roll number
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
