import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { serviceDateOf } from "@/core/time";

export const metadata: Metadata = { title: "Dashboard · Mess OS" };

export default async function AdminDashboardPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();

  // Today in the TENANT's timezone, never UTC (§2.9). A dashboard opened at
  // 00:30 IST must show the new day, not yesterday.
  const today = serviceDateOf(user.timezone, new Date());

  const [students, activeSubs, menusToday, attendanceToday] = await Promise.all([
    supabase.from("students").select("status", { count: "exact" }).eq("tenant_id", user.tenantId),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", user.tenantId)
      .eq("status", "ACTIVE"),
    supabase
      .from("menus")
      .select("meal_slot")
      .eq("tenant_id", user.tenantId)
      .eq("service_date", today),
    supabase
      .from("attendance")
      .select("meal_slot", { count: "exact" })
      .eq("tenant_id", user.tenantId)
      .eq("service_date", today),
  ]);

  const rows = students.data ?? [];
  const counts = {
    total: students.count ?? 0,
    active: rows.filter((r) => r.status === "ACTIVE").length,
    grace: rows.filter((r) => r.status === "GRACE").length,
    blocked: rows.filter((r) => r.status === "BLOCKED").length,
  };

  const isEmpty = counts.total === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Good ${greeting()}, ${user.fullName.split(" ")[0]}`}
        description={`Here is your mess at a glance for ${formatDate(today)}.`}
        action={<Button render={<Link href="/admin/students" />}>Manage students</Button>}
      />

      {isEmpty ? (
        // Empty state that names the next action, per DESIGN.md §1 — not a
        // dashboard of zeros that leaves a new owner wondering what to do.
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-xl">
              <span className="text-xl">👋</span>
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">Let&apos;s set up your mess</h2>
              <p className="text-muted-foreground mx-auto max-w-md text-sm">
                No students yet. Create a meal plan first, then add students and issue their login
                details — they will be able to show a QR code at the counter straight away.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <Button render={<Link href="/admin/plans" />}>Create a plan</Button>
              <Button render={<Link href="/admin/students" />} variant="outline">
                Add students
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Students"
              value={counts.total}
              hint={`${counts.active} active`}
              icon="Users"
            />
            <StatCard
              label="Active plans"
              value={activeSubs.count ?? 0}
              hint="Subscriptions in force"
              icon="ClipboardList"
              tone="success"
            />
            <StatCard
              label="Meals served today"
              value={attendanceToday.count ?? 0}
              hint={`${menusToday.data?.length ?? 0} menus published`}
              icon="ScanLine"
            />
            <StatCard
              label="Needs attention"
              value={counts.grace + counts.blocked}
              hint={`${counts.grace} in grace · ${counts.blocked} blocked`}
              icon="TriangleAlert"
              tone={counts.blocked > 0 ? "danger" : counts.grace > 0 ? "warning" : "default"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Student status</CardTitle>
                <CardDescription>Breakdown across the whole mess.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(["ACTIVE", "GRACE", "BLOCKED", "INACTIVE"] as const).map((status) => {
                  const n = rows.filter((r) => r.status === status).length;
                  const pct = counts.total > 0 ? Math.round((n / counts.total) * 100) : 0;
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <div className="w-32 shrink-0">
                        <StatusBadge status={status} />
                      </div>
                      <div
                        className="bg-muted h-2 flex-1 overflow-hidden rounded-full"
                        role="img"
                        aria-label={`${status}: ${n} students, ${pct}%`}
                      >
                        <div
                          className="bg-primary h-full rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-muted-foreground w-12 shrink-0 text-right text-sm tabular-nums">
                        {n}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Today&apos;s menu</CardTitle>
                <CardDescription>Published for {formatDate(today)}.</CardDescription>
              </CardHeader>
              <CardContent>
                {menusToday.data && menusToday.data.length > 0 ? (
                  <ul className="space-y-2">
                    {menusToday.data.map((m) => (
                      <li
                        key={m.meal_slot}
                        className="border-border flex items-center justify-between rounded-lg border px-3 py-2.5"
                      >
                        <span className="text-sm font-medium capitalize">
                          {m.meal_slot.toLowerCase()}
                        </span>
                        <StatusBadge status="Published" tone="success" />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <p className="text-muted-foreground text-sm">
                      No menu published for today yet.
                    </p>
                    <Button render={<Link href="/admin/menu" />} size="sm" variant="outline">
                      Publish today&apos;s menu
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

function formatDate(serviceDate: string): string {
  const [y, m, d] = serviceDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
