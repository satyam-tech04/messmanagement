import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { TableEmpty, TableError, TableFooterBar, TableShell } from "@/components/data-table";
import { formatPaise, perMealPaise, toPaise } from "@/core/money";
import { planMealsInPeriod } from "@/core/policies/plan.policy";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { CreatePlanDialog, EditPlanDialog, TogglePlanButton, type PlanRow } from "./plan-form";

export const metadata: Metadata = { title: "Plans · Mess OS" };

const COLUMNS = ["Plan", "Meals", "Duration", "Price", "Per meal", "Students", "Status", ""];

export default async function PlansPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("plans")
    .select(
      `id, name, price_paise, duration_type, duration_days, included_meal_slots, is_active,
       subscriptions ( id, status )`,
    )
    .eq("tenant_id", user.tenantId)
    // Active first, then cheapest — the picker order an admin expects.
    .order("is_active", { ascending: false })
    .order("price_paise", { ascending: true });

  const plans: PlanRow[] = (data ?? []).map((p) => {
    const subs = (p.subscriptions ?? []) as unknown as Array<{ id: string; status: string }>;
    return {
      id: p.id,
      name: p.name,
      pricePaise: p.price_paise,
      durationType: p.duration_type as PlanRow["durationType"],
      durationDays: p.duration_days,
      mealSlots: p.included_meal_slots,
      isActive: p.is_active,
      subscriberCount: subs.filter((s) => s.status === "ACTIVE").length,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plans"
        description="What a student pays and which meals it covers. A plan's price is frozen onto each subscription when it is assigned, so changing it here never rewrites an existing student's terms."
        action={<CreatePlanDialog />}
      />

      {error ? (
        <TableError
          description={`The plan list could not be loaded. ${error.message}`}
          retryHref="/admin/plans"
        />
      ) : plans.length === 0 ? (
        <TableEmpty
          icon={<ClipboardList className="size-6" aria-hidden="true" />}
          title="No plans yet"
          description="Create a plan before adding students — without one, a student cannot generate a QR code or be served at the counter."
          action={<CreatePlanDialog />}
        />
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((c, i) => (
                  <TableHead
                    key={c || i}
                    className={
                      c === "Price" || c === "Per meal" || c === "Students"
                        ? "text-right"
                        : i === COLUMNS.length - 1
                          ? "w-0"
                          : undefined
                    }
                  >
                    {c || <span className="sr-only">Actions</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => {
                const price = toPaise(plan.pricePaise);
                const meals = planMealsInPeriod(plan.mealSlots.length, plan.durationDays);
                return (
                  <TableRow key={plan.id} className={plan.isActive ? undefined : "opacity-60"}>
                    <TableCell className="font-medium">{plan.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {plan.mealSlots.map((s) => s.charAt(0) + s.slice(1).toLowerCase()).join(", ")}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="tabular-nums">{plan.durationDays}</span> days
                      <span className="text-muted-foreground block text-xs">
                        {plan.durationType.charAt(0) + plan.durationType.slice(1).toLowerCase()}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">
                      {formatPaise(price)}
                    </TableCell>
                    {/* The rate every future mess-cut credit is computed at —
                        worth showing so a price is chosen with it in view. */}
                    <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                      {formatPaise(perMealPaise(price, meals))}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {plan.subscriberCount}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={plan.isActive ? "ACTIVE" : "RETIRED"} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <EditPlanDialog plan={plan} />
                        <TogglePlanButton plan={plan} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <TableFooterBar shown={plans.length} total={plans.length} noun="plans" />
        </TableShell>
      )}
    </div>
  );
}
