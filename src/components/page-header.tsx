import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Standard page header (DESIGN.md — "Page header on every screen: title,
 * one-line description, primary action top-right").
 *
 * Having one component rather than hand-rolled markup per page is what keeps
 * twenty admin screens looking like one product instead of twenty.
 */
export function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1.5">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-muted-foreground max-w-2xl text-sm">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
