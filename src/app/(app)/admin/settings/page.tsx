import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { TableError } from "@/components/data-table";
import { ALL_MEAL_SLOTS } from "@/core/domain/enums";
import { requireSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { createClient } from "@/infra/supabase/server";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";
import { SettingsForm, type SlotSetting } from "./settings-form";

export const metadata: Metadata = { title: "Settings · Mess OS" };

/** Sensible defaults for a meal the mess does not currently serve. */
const DEFAULT_WINDOWS: Record<string, { start: string; end: string }> = {
  BREAKFAST: { start: "07:30", end: "09:30" },
  LUNCH: { start: "12:00", end: "14:30" },
  SNACKS: { start: "16:30", end: "17:30" },
  DINNER: { start: "19:30", end: "22:00" },
};

export default async function SettingsPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const admin = createAdminClient();

  const settings = await new SupabaseTenantRepository(supabase, admin).getSettings(user.tenantId);

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, slug, timezone")
    .eq("id", user.tenantId)
    .maybeSingle();

  if (!settings) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" description="How this mess operates." />
        <TableError
          title="Settings could not be loaded"
          description="This mess has no settings row. That should not happen — contact support."
          retryHref="/admin/settings"
        />
      </div>
    );
  }

  const slots: SlotSetting[] = ALL_MEAL_SLOTS.map((slot) => {
    const configured = settings.mealSlots.find((s) => s.slot === slot);
    const fallback = DEFAULT_WINDOWS[slot] ?? { start: "12:00", end: "14:00" };
    return {
      slot,
      label: slot.charAt(0) + slot.slice(1).toLowerCase(),
      enabled: Boolean(configured),
      start: configured?.start ?? fallback.start,
      end: configured?.end ?? fallback.end,
    };
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Settings"
        description="Meal times and QR behaviour. Changes take effect on the next scan."
      />

      <Card>
        <CardHeader>
          <CardTitle>{tenant?.name ?? "This mess"}</CardTitle>
          <CardDescription>Identity and timezone, set when the mess was created.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-border divide-y text-sm">
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Identifier</dt>
              <dd className="font-mono">{tenant?.slug}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Timezone</dt>
              <dd className="font-medium">{tenant?.timezone}</dd>
            </div>
          </dl>
          {/* Changing this would move every service date and every meal window,
              so it is deliberately not editable from here. */}
          <p className="text-muted-foreground mt-3 text-xs">
            The timezone decides when each day starts and when meals open. Changing it would shift
            every historical service date, so it is set once at creation — contact support if it is
            wrong.
          </p>
        </CardContent>
      </Card>

      <SettingsForm
        slots={slots}
        qrTokenTtlSeconds={settings.qrTokenTtlSeconds}
        qrRefreshSeconds={settings.qrRefreshSeconds}
      />
    </div>
  );
}
