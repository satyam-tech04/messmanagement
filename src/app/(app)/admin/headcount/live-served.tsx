"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLiveAttendance } from "./use-live-attendance";

interface LiveServed {
  readonly perSlot: Readonly<Record<string, number>>;
  readonly manual: number;
  readonly live: boolean;
}

const LiveServedContext = createContext<LiveServed | null>(null);

function useLiveServed(): LiveServed {
  const value = useContext(LiveServedContext);
  if (!value) throw new Error("Live served counts must be rendered inside <LiveServedProvider>.");
  return value;
}

/**
 * Today's served counts, kept current as meals are scanned anywhere in the mess.
 *
 * The counter and the admin dashboard were server-rendered once and never moved:
 * staff watched "Lunch served 0" while serving lunch, and an owner's dashboard
 * needed a reload to show a single meal. One subscription here feeds every
 * number inside it.
 *
 * A provider with small client leaves, rather than a client grid, so the stat
 * cards stay server components — they pull in the whole icon set, which has no
 * business in the browser bundle for the sake of a number.
 */
export function LiveServedProvider({
  tenantId,
  serviceDate,
  initialPerSlot,
  initialManual,
  children,
}: {
  tenantId: string;
  serviceDate: string;
  initialPerSlot: Readonly<Record<string, number>>;
  initialManual: number;
  children: ReactNode;
}) {
  const [perSlot, setPerSlot] = useState(initialPerSlot);
  const [manual, setManual] = useState(initialManual);

  const live = useLiveAttendance(tenantId, serviceDate, ({ mealSlot, method }) => {
    setPerSlot((current) => ({ ...current, [mealSlot]: (current[mealSlot] ?? 0) + 1 }));
    if (method === "MANUAL") setManual((n) => n + 1);
  });

  return (
    <LiveServedContext.Provider value={{ perSlot, manual, live }}>
      {children}
    </LiveServedContext.Provider>
  );
}

/** Served so far for one meal, or across the day when `slot` is omitted. */
export function LiveServedCount({ slot }: { slot?: string }) {
  const { perSlot } = useLiveServed();
  const n =
    slot === undefined
      ? Object.values(perSlot).reduce((sum, v) => sum + v, 0)
      : (perSlot[slot] ?? 0);
  return <>{n}</>;
}

/** "Breakfast 12 · Lunch 40", in the mess's meal order. */
export function LiveServedBreakdown({ slots }: { slots: readonly string[] }) {
  const { perSlot } = useLiveServed();
  if (slots.length === 0) return <>No meal times configured</>;
  return (
    <>
      {slots
        .map((slot) => `${slot.charAt(0)}${slot.slice(1).toLowerCase()} ${perSlot[slot] ?? 0}`)
        .join(" · ")}
    </>
  );
}

export function LiveManualCount() {
  return <>{useLiveServed().manual}</>;
}

/** Says plainly when the numbers are from page load rather than live. */
export function LiveIndicator() {
  const { live } = useLiveServed();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        live
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
          : "bg-muted text-muted-foreground",
      )}
    >
      <Radio className={cn("size-3.5", live && "animate-pulse")} aria-hidden="true" />
      {live ? "Live" : "Not live — reload for the latest counts"}
    </span>
  );
}
