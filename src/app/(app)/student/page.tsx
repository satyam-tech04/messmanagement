import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import type { MealSlot } from "@/core/domain/enums";
import { isWithinWindow, serviceDateOf, toServiceDate } from "@/core/time";
import { mealToShow } from "@/core/policies/eligibility.policy";
import { serviceSlotsInOrder } from "@/core/policies/menu.policy";
import { readStudentPlan } from "@/infra/queries/student-plan";
import { subscriptionStateLabel, type SubscriptionState } from "@/core/policies/subscription-state";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";
import { formatServiceDate } from "@/lib/format";
import { QrDisplay } from "./qr-display";
import { AnnouncementsCard } from "./announcements-card";
import { readStudentAnnouncements } from "@/infra/queries/student-announcements";
import { pageTitle } from "@/lib/app-info";

export const metadata: Metadata = { title: pageTitle("My QR") };

export default async function StudentPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const today = serviceDateOf(user.timezone, new Date());

  // RLS restricts these to the signed-in student's own rows; the explicit
  // tenant filter is the application-layer half of the same guarantee (§5.1).
  const [studentRes, plan, menuRes, attendanceRes] = await Promise.all([
    supabase
      .from("students")
      .select("roll_number, status, block, room_number")
      .eq("tenant_id", user.tenantId)
      .maybeSingle(),
    // The shared reader, not `status = ACTIVE … maybeSingle()`: since renewals
    // (migration 017) a student can hold several ACTIVE rows — an ended term
    // still reads ACTIVE — and maybeSingle() errors on two, which showed a
    // renewed student "You have no active meal plan".
    readStudentPlan(supabase, user),
    supabase
      .from("menus")
      .select("meal_slot, items")
      .eq("tenant_id", user.tenantId)
      .eq("service_date", today),
    supabase
      .from("attendance")
      .select("meal_slot")
      .eq("tenant_id", user.tenantId)
      .eq("service_date", today)
      // A reversed meal never happened, so it must not mark this student as
      // already fed — that would leave them unable to get the meal the
      // correction was made to give back.
      .is("reversed_at", null),
  ]);

  // Resolved HERE, on the server, so a student whose counter is shut costs
  // nothing at all: no token is minted, no rotation starts, and the page can
  // say "dinner opens at 19:30" from data it already had to load. The settings
  // read is cached (see tenant.repository.ts), so this is usually free.
  const settings = await new SupabaseTenantRepository(supabase, createAdminClient()).getSettings(
    user.tenantId,
  );

  // Shared with GET /api/student/announcements, so the app shows the same notices.
  const liveAnnouncements = await readStudentAnnouncements(supabase, user);

  // The same meal the token endpoint will mint for, so the page never says
  // "breakfast is open" to a student whose plan starts at lunch.
  const now = new Date();
  const target = settings
    ? mealToShow(
        serviceSlotsInOrder({ timeZone: user.timezone, now, slots: settings.mealSlots }),
        plan.history.map((s) => ({
          status: s.status,
          startDate: toServiceDate(s.startDate),
          endDate: toServiceDate(s.endDate),
          includedMealSlots: s.includedMealSlots as MealSlot[],
        })),
      )
    : undefined;

  const student = studentRes.data;
  const subscription = plan.current;
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

      <AnnouncementsCard announcements={liveAnnouncements} />

      <Card className="overflow-hidden">
        <CardContent className="flex flex-col items-center gap-5 py-10">
          <div className="space-y-1.5 text-center">
            <h2 className="text-xl font-semibold">Your meal QR code</h2>
            <p className="text-muted-foreground mx-auto max-w-sm text-sm">
              Show this at the counter. Keep the screen open while you queue.
            </p>
          </div>
          {/* Renders its own denial states — a blocked student or one without a
              plan is told why here, rather than finding out at the counter. */}
          <div className="w-full max-w-sm">
            <QrDisplay
              timeZone={user.timezone}
              counter={
                !target
                  ? { state: "NONE" }
                  : isWithinWindow(now, target)
                    ? {
                        state: "OPEN",
                        mealSlot: target.slot,
                        closesAt: target.closesAt.toISOString(),
                      }
                    : {
                        state: "CLOSED",
                        mealSlot: target.slot,
                        opensAt: target.opensAt.toISOString(),
                      }
              }
            />
          </div>
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
                    <StatusBadge
                      status={subscriptionStateLabel(subscription.state as SubscriptionState)}
                      tone="success"
                    />
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Meals included</dt>
                  <dd className="font-medium capitalize">
                    {subscription.includedMealSlots.map((s) => s.toLowerCase()).join(", ")}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Valid until</dt>
                  <dd className="font-medium tabular-nums">
                    {formatServiceDate(subscription.endDate)}
                  </dd>
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
