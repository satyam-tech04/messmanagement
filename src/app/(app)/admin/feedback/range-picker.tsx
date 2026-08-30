"use client";

import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** How far back to look. Defaults to a fortnight, which is enough to see a trend. */
export function RangePicker({ from, today }: { from: string; today: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="from" className="text-muted-foreground text-sm">
        Since
      </Label>
      <Input
        id="from"
        type="date"
        value={from}
        max={today}
        className="w-auto tabular-nums"
        onChange={(e) => router.push(`/admin/feedback?from=${e.target.value}`)}
      />
    </div>
  );
}
