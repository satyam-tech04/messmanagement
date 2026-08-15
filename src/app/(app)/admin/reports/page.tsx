import type { Metadata } from "next";
import { Download, IndianRupee, Receipt, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { formatPaise, toPaise } from "@/core/money";
import { summariseRevenue } from "@/core/policies/revenue.policy";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";

export const metadata: Metadata = { title: "Reports · Mess OS" };

/**
 * Where data leaves the system.
 *
 * Deliberately shows the headline numbers next to the download, so an owner can
 * sanity-check a file before opening it — a total that looks wrong on screen is
 * caught here rather than after it has been mailed to an accountant.
 */
const EXPORTS = [
  {
    href: "/admin/students/export",
    icon: Users,
    title: "Students",
    description:
      "Everyone enrolled, with their room, contact details and current plan. Written in the same format the importer reads, so you can edit this file in Excel and load it straight back.",
  },
  {
    href: "/admin/reports/subscriptions",
    icon: Receipt,
    title: "Subscriptions",
    description:
      "Every subscription ever issued: dates, meals included, what was paid and the per-day rate. This is the detail behind the revenue figures.",
  },
  {
    href: "/admin/reports/revenue",
    icon: IndianRupee,
    title: "Revenue by month",
    description:
      "Collections grouped by the month each plan started, with money still owed kept in its own column so it is never counted as received.",
  },
] as const;

export default async function ReportsPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("subscriptions")
    .select("start_date, end_date, price_paise_snapshot, status")
    .eq("tenant_id", user.tenantId);

  const months = summariseRevenue(
    (data ?? []).map((s) => ({
      startDate: s.start_date,
      endDate: s.end_date,
      pricePaise: s.price_paise_snapshot,
      status: s.status,
    })),
  );

  const collected = months.reduce((n, m) => n + m.collectedPaise, 0);
  const pending = months.reduce((n, m) => n + m.pendingPaise, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Take your data out as CSV. Every download is recorded in the audit log."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Collected"
          value={formatPaise(toPaise(collected))}
          hint="Across every subscription issued."
        />
        <StatCard
          label="Still owed"
          value={formatPaise(toPaise(pending))}
          hint="Plans agreed but not yet paid for."
        />
        <StatCard
          label="Months with income"
          value={String(months.length)}
          hint="Counted by the month each plan started."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {EXPORTS.map((e) => (
          <Card key={e.href}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <e.icon className="text-muted-foreground size-4" aria-hidden="true" />
                {e.title}
              </CardTitle>
              <CardDescription>{e.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {/* A real anchor, not next/link: these are route handlers that
                  return a file, and client navigation would try to render the
                  CSV as a page. */}
              <Button variant="outline" size="sm" render={<a href={e.href} />}>
                <Download className="size-4" aria-hidden="true" />
                Download CSV
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Said plainly, because an owner reading "revenue" will otherwise assume
          it means what their accountant means by it. */}
      <p className="text-muted-foreground max-w-3xl text-xs">
        Revenue is reported <strong>when it was collected</strong>, not spread across the months a
        plan covers — nothing records when payment actually arrived, only what each plan was worth,
        and a spread figure would be a guess. The subscriptions export carries the start and end
        dates if you want to apportion it yourself.
      </p>
    </div>
  );
}
