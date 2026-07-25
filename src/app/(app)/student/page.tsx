import type { Metadata } from "next";
import Link from "next/link";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { serviceDateOf } from "@/core/time";

export const metadata: Metadata = { title: "My QR · Mess OS" };

export default async function StudentPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const today = serviceDateOf(user.timezone, new Date());

  // RLS restricts these to the signed-in student's own rows; the explicit
  // tenant filter is the application-layer half of the same guarantee (§5.1).
  const [studentRes, subRes, menuRes, attendanceRes] = await Promise.all([
    supabase
      .from("students")
      .select("roll_number, status, block, room_number")
      .eq("tenant_id", user.tenantId)
      .maybeSingle(),
    supabase
      .from("subscriptions")
      .select("status, start_date, end_date, included_meal_slots_snapshot")
      .eq("tenant_id", user.tenantId)
      .eq("status", "ACTIVE")
      .maybeSingle(),
    supabase
      .from("menus")
      .select("meal_slot, items")
      .eq("tenant_id", user.tenantId)
      .eq("service_date", today),
    supabase
      .from("attendance")
      .select("meal_slot")
      .eq("tenant_id", user.tenantId)
      .eq("service_date", today),
  ]);

  const student = studentRes.data;
  const subscription = subRes.data;
  const eatenSlots = new Set((attendanceRes.data ?? []).map((a) => a.meal_slot));

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Hello, ${user.fullName.split(" ")[0]}`}
        description={
          student
            ? `Roll number ${student.roll_number}${
                student.room_number ? ` · Room ${student.room_number}` : ""
              }`
            : undefined
        }
        action={student ? <StatusBadge status={student.status} /> : undefined}
      />

      <Card className="overflow-hidden">
        <CardContent className="flex flex-col items-center gap-5 py-12 text-center">
          <div className="bg-primary/10 text-primary flex size-20 items-center justify-center rounded-2xl">
            <QrCode className="size-10" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold">Your meal QR code</h2>
            <p className="text-muted-foreground mx-auto max-w-sm text-sm">
              {subscription
                ? "Show this at the counter. It refreshes every few seconds, so keep the screen open while you queue."
                : "You need an active meal plan before you can get a QR code. Speak to the mess admin."}
            </p>
          </div>
          <Button size="lg" className="h-12 w-full max-w-xs text-base" disabled>
            QR code arrives in Phase 1
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>My plan</CardTitle>
            <CardDescription>Your current meal subscription.</CardDescription>
          </CardHeader>
          <CardContent>
            {subscription ? (
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <StatusBadge status={subscription.status} />
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Meals included</dt>
                  <dd className="font-medium capitalize">
                    {subscription.included_meal_slots_snapshot
                      .map((s) => s.toLowerCase())
                      .join(", ")}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Valid until</dt>
                  <dd className="font-medium tabular-nums">{subscription.end_date}</dd>
                </div>
              </dl>
            ) : (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-muted-foreground text-sm">You have no active meal plan.</p>
                <Button render={<Link href="/student/plan" />} size="sm" variant="outline">
                  View plans
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s menu</CardTitle>
            <CardDescription>What&apos;s being served.</CardDescription>
          </CardHeader>
          <CardContent>
            {menuRes.data && menuRes.data.length > 0 ? (
              <ul className="space-y-3">
                {menuRes.data.map((m) => {
                  const items = Array.isArray(m.items) ? (m.items as unknown[]) : [];
                  return (
                    <li key={m.meal_slot} className="border-border rounded-lg border p-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-sm font-medium capitalize">
                          {m.meal_slot.toLowerCase()}
                        </span>
                        {eatenSlots.has(m.meal_slot) ? (
                          <StatusBadge status="Eaten" tone="success" />
                        ) : null}
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {items.length > 0 ? items.map(String).join(" · ") : "Menu not detailed"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted-foreground py-8 text-center text-sm">
                No menu published for today yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
