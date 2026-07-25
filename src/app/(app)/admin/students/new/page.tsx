import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { StudentForm, type PlanOption } from "./student-form";

export const metadata: Metadata = { title: "Add student · Mess OS" };

export default async function NewStudentPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();

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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/admin/students" />}>
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back to students
      </Button>

      <PageHeader
        title="Add student"
        description="Creates their login and, optionally, an active meal plan."
      />

      <StudentForm plans={options} />
    </div>
  );
}
