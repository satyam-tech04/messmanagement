import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { TableError } from "@/components/data-table";
import { resolveServiceState } from "@/core/policies/menu.policy";
import { addDays, eachDateInclusive, serviceDateOf, toServiceDate } from "@/core/time";
import { requireSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { createClient } from "@/infra/supabase/server";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";
import { formatServiceDate } from "@/lib/format";
import { ClearMenuButton, EditMenuDialog, PublishedTick, type MenuCell } from "./menu-editor";

export const metadata: Metadata = { title: "Menu · Mess OS" };

const DAYS_SHOWN = 7;

function slotLabel(slot: string): string {
  return slot.charAt(0) + slot.slice(1).toLowerCase();
}

function weekdayOf(date: string): string {
  // Parsed as parts, never `new Date(date)`, which would be read as UTC midnight
  // and name the wrong weekday west of Greenwich.
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  );
}

export default async function MenuPage(props: { searchParams: Promise<{ from?: string }> }) {
  const { from: fromParam } = await props.searchParams;
  const user = await requireSessionUser();
  const supabase = await createClient();
  const admin = createAdminClient();

  const settings = await new SupabaseTenantRepository(supabase, admin).getSettings(user.tenantId);

  const today = serviceDateOf(user.timezone, new Date());
  const from =
    fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? toServiceDate(fromParam) : today;
  const to = addDays(from, DAYS_SHOWN - 1);
  const dates = eachDateInclusive(from, to);

  const { data, error } = await supabase
    .from("menus")
    .select("service_date, meal_slot, items, notes")
    .eq("tenant_id", user.tenantId)
    .gte("service_date", from)
    .lte("service_date", to);

  const published = new Map<string, { items: string[]; notes: string | null }>();
  for (const row of data ?? []) {
    published.set(`${row.service_date}|${row.meal_slot}`, {
      items: (row.items as string[]) ?? [],
      notes: row.notes,
    });
  }

  const state = settings
    ? resolveServiceState({ timeZone: user.timezone, now: new Date(), slots: settings.mealSlots })
    : undefined;

  const servedSlots = settings?.mealSlots ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Menu"
        description="What the kitchen is serving. Publish ahead — students see it the moment you do."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/admin/menu?from=${addDays(from, -DAYS_SHOWN)}`} />}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Earlier
            </Button>
            {from !== today ? (
              <Button variant="outline" size="sm" render={<Link href="/admin/menu" />}>
                Today
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/admin/menu?from=${addDays(from, DAYS_SHOWN)}`} />}
            >
              Later
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        }
      />

      {!settings ? (
        <TableError
          title="Meal times are not configured"
          description="This mess has no meal slots set up, so there is nothing to publish a menu against. Configure them under Settings first."
        />
      ) : error ? (
        <TableError
          description={`The menu could not be loaded. ${error.message}`}
          retryHref="/admin/menu"
        />
      ) : (
        <div className="space-y-3">
          {dates.map((date) => {
            const isToday = date === today;
            const isPast = date < today;

            return (
              <Card
                key={date}
                className={
                  isToday ? "border-primary/40 shadow-sm" : isPast ? "opacity-70" : undefined
                }
              >
                <CardContent className="space-y-4 pt-6">
                  <div className="flex items-baseline gap-2.5">
                    <h2 className="font-semibold">
                      {weekdayOf(date)} · {formatServiceDate(date)}
                    </h2>
                    {isToday ? (
                      <span className="text-primary text-xs font-medium">Today</span>
                    ) : null}
                    {isPast ? <span className="text-muted-foreground text-xs">Past</span> : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {servedSlots.map((config) => {
                      const key = `${date}|${config.slot}`;
                      const entry = published.get(key);
                      const cell: MenuCell = {
                        serviceDate: date,
                        slot: config.slot,
                        slotLabel: slotLabel(config.slot),
                        window: `${config.start}–${config.end}`,
                        items: entry?.items ?? [],
                        notes: entry?.notes ?? null,
                      };
                      const hasContent = cell.items.length > 0 || Boolean(cell.notes);
                      const isBeingServed =
                        state?.current?.slot === config.slot && state.current.serviceDate === date;

                      return (
                        <div
                          key={config.slot}
                          className={`rounded-lg border p-4 ${
                            isBeingServed
                              ? "border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20"
                              : ""
                          }`}
                        >
                          <div className="mb-2.5 flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium">
                                {slotLabel(config.slot)}
                                {isBeingServed ? (
                                  <span className="ml-2 text-xs font-normal text-emerald-600 dark:text-emerald-400">
                                    Being served now
                                  </span>
                                ) : null}
                              </p>
                              <p className="text-muted-foreground text-xs tabular-nums">
                                {config.start}–{config.end}
                              </p>
                            </div>
                            <div className="flex shrink-0 gap-1">
                              <EditMenuDialog cell={cell} dateLabel={formatServiceDate(date)} />
                              {hasContent ? (
                                <ClearMenuButton cell={cell} dateLabel={formatServiceDate(date)} />
                              ) : null}
                            </div>
                          </div>

                          {hasContent ? (
                            <>
                              {cell.items.length > 0 ? (
                                <ul className="space-y-0.5 text-sm">
                                  {cell.items.map((item) => (
                                    <li key={item} className="text-muted-foreground">
                                      {item}
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                              {cell.notes ? (
                                <p className="mt-2 text-xs italic">{cell.notes}</p>
                              ) : null}
                              <div className="mt-2.5">
                                <PublishedTick />
                              </div>
                            </>
                          ) : (
                            /* Never a bare "No data" — say what is missing and
                               that the student will see the gap. */
                            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                              <UtensilsCrossed className="size-3.5" aria-hidden="true" />
                              Not published — students see nothing for this meal.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
