"use client";

import { useEffect, useState } from "react";
import { Radio, TrendingDown, TrendingUp } from "lucide-react";
import { createClient } from "@/infra/supabase/client";
import { cn } from "@/lib/utils";

export interface SlotCount {
  readonly mealSlot: string;
  readonly projected: number;
  readonly served: number;
  readonly locked: boolean;
}

function slotLabel(slot: string): string {
  return slot.charAt(0) + slot.slice(1).toLowerCase();
}

/**
 * Live served-vs-projected, driven by Postgres realtime on `attendance`.
 *
 * Subscribed rather than polled: the kitchen watches this during service and a
 * 30-second poll would show a number that is always stale by half a minute at
 * exactly the moment it matters.
 *
 * Falls back gracefully — if the socket never connects, the server-rendered
 * counts are still correct as of page load, and the indicator says so rather
 * than implying live data that is not arriving.
 */
export function LiveCount({
  initial,
  tenantId,
  serviceDate,
}: {
  initial: readonly SlotCount[];
  tenantId: string;
  serviceDate: string;
}) {
  const [counts, setCounts] = useState<readonly SlotCount[]>(initial);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`attendance:${tenantId}:${serviceDate}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "attendance",
          // RLS still applies to realtime, so this filter is a bandwidth
          // optimisation rather than the security boundary.
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const row = payload.new as { service_date?: string; meal_slot?: string };
          // A late scan for yesterday's dinner must not bump today's number.
          if (row.service_date !== serviceDate || !row.meal_slot) return;

          setCounts((current) =>
            current.map((c) => (c.mealSlot === row.meal_slot ? { ...c, served: c.served + 1 } : c)),
          );
        },
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId, serviceDate]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
            live
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Radio className={cn("size-3.5", live && "animate-pulse")} aria-hidden="true" />
          {live ? "Live" : "Not live — showing counts from page load"}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {counts.map((count) => {
          const variance = count.served - count.projected;
          const pct =
            count.projected === 0 ? 0 : Math.round((count.served / count.projected) * 100);

          return (
            <div key={count.mealSlot} className="bg-card rounded-xl border p-5 shadow-sm">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold">{slotLabel(count.mealSlot)}</h3>
                {count.locked ? (
                  <span className="text-muted-foreground text-xs">Count locked</span>
                ) : (
                  <span className="text-muted-foreground text-xs">Projection may still move</span>
                )}
              </div>

              <div className="mt-3 flex items-end gap-2">
                <span className="text-4xl font-semibold tabular-nums">{count.served}</span>
                <span className="text-muted-foreground pb-1 text-sm">
                  of <span className="tabular-nums">{count.projected}</span> expected
                </span>
              </div>

              {/* Bar is capped at 100% so an over-served meal does not render a
                  bar wider than its container. */}
              <div
                className="bg-muted mt-3 h-2 overflow-hidden rounded-full"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${slotLabel(count.mealSlot)} served`}
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    variance > 0 ? "bg-amber-500" : "bg-emerald-500",
                  )}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>

              <p className="text-muted-foreground mt-2.5 flex items-center gap-1.5 text-xs">
                {variance === 0 ? (
                  "Exactly on the projection."
                ) : variance > 0 ? (
                  <>
                    <TrendingUp className="size-3.5 text-amber-600" aria-hidden="true" />
                    <span className="tabular-nums">{variance}</span> more than expected — the
                    kitchen may run short.
                  </>
                ) : (
                  <>
                    <TrendingDown className="size-3.5" aria-hidden="true" />
                    <span className="tabular-nums">{Math.abs(variance)}</span> fewer than expected
                    so far.
                  </>
                )}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
