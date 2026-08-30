"use client";

import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Single-date selection only.
 *
 * Ranges ("this week", "this month") are explicitly out of scope for v1
 * (spec §11) — building them now would mean choosing a week-start convention
 * nobody has decided.
 */
export function DatePicker({ date, today }: { date: string; today: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="date" className="text-muted-foreground text-sm">
        Day
      </Label>
      <Input
        id="date"
        type="date"
        value={date}
        max={today}
        className="w-auto tabular-nums"
        onChange={(e) => router.push(`/admin/counter-sales?date=${e.target.value}`)}
      />
    </div>
  );
}
