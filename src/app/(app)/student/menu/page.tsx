import type { Metadata } from "next";
import { CalendarDays, UtensilsCrossed } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableError } from "@/components/data-table";
import { resolveServiceState } from "@/core/policies/menu.policy";
import { addDays, eachDateInclusive, serviceDateOf } from "@/core/time";
import { requireSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { createClient } from "@/infra/supabase/server";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";
import { formatServiceDate } from "@/lib/format";

export const metadata: Metadata = { title: "Menu · Mess OS" };

const DAYS_AHEAD = 3;

function slotLabel(slot: string): string {
  return slot.charAt(0) + slot.slice(1).toLowerCase();
}

export default async function StudentMenuPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const admin = createAdminClient();

  const settings = await new SupabaseTenantRepository(supabase, admin).getSettings(user.tenantId);
  const today = serviceDateOf(user.timezone, new Date());
  const to = addDays(today, DAYS_AHEAD);

  const { data, error } = await supabase
    .from("menus")
    .select("service_date, meal_slot, items, notes")
    .eq("tenant_id", user.tenantId)
    .gte("service_date", today)
    .lte("service_date", to)
    .order("service_date", { ascending: true });

  const byKey = new Map<string, { items: string[]; notes: string | null }>();
  for (const row of data ?? []) {
    byKey.set(`${row.service_date}|${row.meal_slot}`, {
      items: (row.items as string[]) ?? [],
      notes: row.notes,
    });
  }

  const state = settings
    ? resolveServiceState({ timeZone: user.timezone, now: new Date(), slots: settings.mealSlots })
    : undefined;

  const servedSlots = settings?.mealSlots ?? [];
  const dates = eachDateInclusive(today, to);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Menu"
        description={
          state?.current
            ? `${slotLabel(state.current.slot)} is being served now.`
            : state?.next
              ? `Next: ${slotLabel(state.next.slot)}${
                  state.next.serviceDate === today ? " today" : " tomorrow"
                }.`
              : "What the mess is serving."
        }
      />

      {error ? (
        <TableError
          description={`The menu could not be loaded. ${error.message}`}
          retryHref="/student/menu"
        />
      ) : servedSlots.length === 0 ? (
        <TableEmpty
          icon={<UtensilsCrossed className="size-6" aria-hidden="true" />}
          title="No meal times set up"
          description="The mess has not configured its meal times yet. Ask the mess office."
        />
      ) : (
        <div className="space-y-4">
          {dates.map((date) => {
            const anyPublished = servedSlots.some((s) => byKey.has(`${date}|${s.slot}`));

            return (
              <Card key={date} className={date === today ? "border-primary/40" : undefined}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-baseline gap-2">
                    <h2 className="font-semibold">
                      {date === today ? "Today" : formatServiceDate(date)}
                    </h2>
                    {date === today ? (
                      <span className="text-muted-foreground text-xs">
                        {formatServiceDate(date)}
                      </span>
                    ) : null}
                  </div>

                  {!anyPublished ? (
                    <p className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
                      <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
                      Not published yet. The mess usually posts this the day before.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {servedSlots.map((config) => {
                        const entry = byKey.get(`${date}|${config.slot}`);
                        const isNow =
                          state?.current?.slot === config.slot &&
                          state.current.serviceDate === date;

                        return (
                          <div
                            key={config.slot}
                            className={`rounded-lg border p-3.5 ${
                              isNow
                                ? "border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20"
                                : ""
                            }`}
                          >
                            <div className="mb-1.5 flex items-baseline justify-between gap-2">
                              <p className="text-sm font-medium">
                                {slotLabel(config.slot)}
                                {isNow ? (
                                  <span className="ml-2 text-xs font-normal text-emerald-600 dark:text-emerald-400">
                                    Being served
                                  </span>
                                ) : null}
                              </p>
                              <p className="text-muted-foreground text-xs tabular-nums">
                                {config.start}–{config.end}
                              </p>
                            </div>

                            {entry ? (
                              <>
                                {entry.items.length > 0 ? (
                                  <ul className="space-y-0.5 text-sm">
                                    {entry.items.map((item) => (
                                      <li key={item}>{item}</li>
                                    ))}
                                  </ul>
                                ) : null}
                                {entry.notes ? (
                                  <p className="text-muted-foreground mt-1.5 text-xs italic">
                                    {entry.notes}
                                  </p>
                                ) : null}
                              </>
                            ) : (
                              <p className="text-muted-foreground text-xs">Not published yet.</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
