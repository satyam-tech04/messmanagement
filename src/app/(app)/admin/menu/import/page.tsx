import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireSessionUser } from "@/infra/auth/session";
import { endOfMonth, serviceDateOf, toServiceDate } from "@/core/time";
import { MenuImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import menu · Mess OS" };

export default async function MenuImportPage() {
  const user = await requireSessionUser();
  const today = serviceDateOf(user.timezone, new Date());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import a menu"
        description="Upload the mess's weekly menu once and publish it across a month. The week repeats over every date in the range you choose."
        action={
          <Button render={<Link href="/admin/menu" />} variant="outline">
            Back to menu
          </Button>
        }
      />
      <MenuImportClient today={today} monthEnd={endOfMonth(toServiceDate(today))} />
    </div>
  );
}
