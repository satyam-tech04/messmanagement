import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { ImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import students · Mess OS" };

export default async function ImportStudentsPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();

  // Named in the guidance so the admin can copy an exact plan name rather than
  // guessing and discovering the mismatch at preview time.
  const { data: plans } = await supabase
    .from("plans")
    .select("name")
    .eq("tenant_id", user.tenantId)
    .eq("is_active", true)
    .order("name");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/admin/students" />}>
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back to students
      </Button>

      <PageHeader
        title="Import students"
        description="Load a whole hostel from a spreadsheet. Nothing is written until you have seen exactly what will happen."
      />

      <ImportClient planNames={(plans ?? []).map((p) => p.name)} />
    </div>
  );
}
