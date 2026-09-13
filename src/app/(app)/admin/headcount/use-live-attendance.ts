"use client";

import { useEffect, useRef, useState } from "react";
import { createRealtimeClient } from "@/infra/supabase/client";

export interface ServedRow {
  readonly mealSlot: string;
  readonly method: string | null;
}

/**
 * Calls `onServed` for every meal recorded today in this mess, as it happens.
 *
 * One subscription shape for every screen that shows a served count — the live
 * headcount, the counter, the admin dashboard — so they cannot drift on the
 * details that made this hard to get right:
 *
 *   - RLS applies to realtime, and the socket authenticates separately from REST.
 *     Without the access token it subscribes as anonymous, matches nothing, and
 *     still reports SUBSCRIBED. The live count once showed "Live" over a number
 *     that never moved.
 *   - A late scan for yesterday's dinner must not bump today's number.
 *
 * @returns whether the socket is actually subscribed, so a screen can say when
 * it is showing page-load numbers instead of implying live data.
 */
export function useLiveAttendance(
  tenantId: string,
  serviceDate: string,
  onServed: (row: ServedRow) => void,
): boolean {
  const [live, setLive] = useState(false);

  // Read through a ref so a new callback identity on each render does not tear
  // the socket down and rebuild it mid-service.
  const onServedRef = useRef(onServed);
  useEffect(() => {
    onServedRef.current = onServed;
  }, [onServed]);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      const supabase = await createRealtimeClient();
      if (!supabase || cancelled) return;

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
            const row = payload.new as {
              service_date?: string;
              meal_slot?: string;
              method?: string;
            };
            if (row.service_date !== serviceDate || !row.meal_slot) return;
            onServedRef.current({ mealSlot: row.meal_slot, method: row.method ?? null });
          },
        )
        .subscribe((status) => setLive(status === "SUBSCRIBED"));

      cleanup = () => {
        void supabase.removeChannel(channel);
        setLive(false);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [tenantId, serviceDate]);

  return live;
}
