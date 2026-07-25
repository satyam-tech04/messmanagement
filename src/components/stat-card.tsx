import type { ReactNode } from "react";
import * as Icons from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * KPI tile for dashboard headers.
 *
 * Numbers use tabular figures so a column of tiles does not visibly jitter as
 * values update over realtime — the live headcount changes on every scan during
 * service, and proportional digits make that motion look like a glitch.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: string;
  tone?: "default" | "success" | "warning" | "danger";
  className?: string;
}) {
  const Icon = icon
    ? ((Icons as unknown as Record<string, Icons.LucideIcon>)[icon] ?? Icons.Circle)
    : null;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground text-sm font-medium">{label}</p>
          <p
            className={cn(
              "text-3xl font-semibold tracking-tight tabular-nums",
              tone === "success" && "text-emerald-600 dark:text-emerald-400",
              tone === "warning" && "text-amber-600 dark:text-amber-400",
              tone === "danger" && "text-red-600 dark:text-red-400",
            )}
          >
            {value}
          </p>
          {hint ? <p className="text-muted-foreground truncate text-xs">{hint}</p> : null}
        </div>
        {Icon ? (
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg",
              tone === "success" &&
                "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400",
              tone === "warning" &&
                "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400",
              tone === "danger" && "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400",
              tone === "default" && "bg-primary/10 text-primary",
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
