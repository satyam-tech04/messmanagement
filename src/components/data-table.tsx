import type { ReactNode } from "react";
import { AlertCircle, Inbox } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Table shells for the four states every list must handle (DESIGN.md §1).
 *
 * These exist so that "empty" and "error" are as easy to render as "populated".
 * When the fallback states take effort, they get skipped — and a mess owner
 * opening a screen that says nothing but "No data" cannot tell whether the
 * product is broken or they simply have not added anything yet.
 */

export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card overflow-hidden rounded-xl border shadow-sm", className)}>
      {/* Wide tables scroll inside their own container so the page body never
          scrolls horizontally on a phone. */}
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

/** Skeleton rows sized to the real ones, so the layout does not jump on load. */
export function TableLoading({ columns, rows = 8 }: { columns: readonly string[]; rows?: number }) {
  return (
    <TableShell>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c}>{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody aria-busy="true">
          {Array.from({ length: rows }).map((_, r) => (
            <TableRow key={r}>
              {columns.map((c) => (
                <TableCell key={c} className="py-3.5">
                  <Skeleton className="h-4 w-[70%]" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableShell>
  );
}

/**
 * Empty state. `action` is mandatory in spirit: an empty list should always
 * name the thing that fills it.
 */
export function TableEmpty({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="bg-card flex flex-col items-center gap-4 rounded-xl border px-6 py-16 text-center shadow-sm">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-xl">
        {icon ?? <Inbox className="size-6" aria-hidden="true" />}
      </div>
      <div className="space-y-1.5">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-muted-foreground mx-auto max-w-sm text-sm">{description}</p>
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

/**
 * Error state. Says what failed and offers a way forward — never a bare
 * "Something went wrong", which leaves staff with nothing to act on.
 */
export function TableError({
  title = "Could not load this list",
  description,
  retryHref,
}: {
  title?: string;
  description: string;
  retryHref?: string;
}) {
  return (
    <div className="border-destructive/30 bg-destructive/5 flex flex-col items-center gap-4 rounded-xl border px-6 py-16 text-center">
      <div className="bg-destructive/10 text-destructive flex size-12 items-center justify-center rounded-xl">
        <AlertCircle className="size-6" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-muted-foreground mx-auto max-w-md text-sm">{description}</p>
      </div>
      {retryHref ? (
        <Button variant="outline" size="sm" render={<a href={retryHref} />}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Row count plus pagination summary, shown under every table. */
export function TableFooterBar({
  shown,
  total,
  noun,
  children,
}: {
  shown: number;
  total: number;
  noun: string;
  children?: ReactNode;
}) {
  return (
    <div className="text-muted-foreground flex flex-col gap-3 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p aria-live="polite">
        Showing <span className="text-foreground font-medium tabular-nums">{shown}</span> of{" "}
        <span className="text-foreground font-medium tabular-nums">{total}</span> {noun}
      </p>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  );
}
