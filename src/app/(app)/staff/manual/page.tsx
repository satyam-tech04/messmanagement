import type { Metadata } from "next";
import Link from "next/link";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { TableError } from "@/components/data-table";
import { requireSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { createClient } from "@/infra/supabase/server";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";
import { ManualPageClient } from "./manual-page-client";

export const metadata: Metadata = { title: "Manual entry · Mess OS" };

export default async function ManualEntryPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const admin = createAdminClient();

  const settings = await new SupabaseTenantRepository(supabase, admin).getSettings(user.tenantId);

  // Same identifier the scanner uses, so the audit log shows one counter
  // whichever screen the entry came from.
  const deviceId = `counter-${user.actorProfileId.slice(0, 8)}`;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader
        title="Manual entry"
        description="Serve a student without scanning — a dead phone, or a code that will not read."
        action={
          <Button variant="outline" render={<Link href="/staff" />}>
            <ScanLine className="size-4" aria-hidden="true" />
            Back to scanner
          </Button>
        }
      />

      {!settings || settings.mealSlots.length === 0 ? (
        <TableError
          title="Meal times are not configured"
          description="This mess has no meal slots set up, so there is nothing to serve against. Ask the mess admin."
        />
      ) : (
        <ManualPageClient
          deviceId={deviceId}
          servedSlots={settings.mealSlots.map((s) => ({
            slot: s.slot,
            label: s.slot.charAt(0) + s.slot.slice(1).toLowerCase(),
            window: `${s.start}–${s.end}`,
          }))}
        />
      )}
    </div>
  );
}
