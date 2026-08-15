import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { formatPaise, toPaise } from "@/core/money";
import { serviceDateOf } from "@/core/time";
import { StudentForm, type PlanOption } from "./student-form";
import { BulkStudentForm, type BulkPlanOption } from "./bulk-form";
import { AddStudentTabs } from "./add-student-tabs";

export const metadata: Metadata = { title: "Add student · Mess OS" };

export default async function NewStudentPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  // The tenant's day, never the browser's or the server's (rule 9).
  const today = serviceDateOf(user.timezone, new Date());

  const { data: plans } = await supabase
    .from("plans")
    .select("id, name, price_paise, included_meal_slots")
    .eq("tenant_id", user.tenantId)
    .eq("is_active", true)
    .order("price_paise", { ascending: true });

  const options: PlanOption[] = (plans ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    pricePaise: p.price_paise,
    mealSlots: p.included_meal_slots,
  }));

  const bulkOptions: BulkPlanOption[] = (plans ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    priceLabel: formatPaise(toPaise(p.price_paise)),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/admin/students" />}>
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back to students
      </Button>

      <PageHeader
        title="Add students"
        description="Creates their logins and, optionally, an active meal plan."
      />

      <AddStudentTabs
        single={<StudentForm plans={options} today={today} />}
        bulk={<BulkStudentForm plans={bulkOptions} today={today} />}
      />
    </div>
  );
}
