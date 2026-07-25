import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading state (DESIGN.md §7 — "loading is never a blank screen").
 *
 * The skeleton mirrors the real dashboard layout: header, a row of stat tiles,
 * then two panels. Matching the eventual shape means the page does not visibly
 * reflow when data arrives, which is what makes a load feel fast rather than
 * merely quick.
 */
export default function AppLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="border-border space-y-2 border-b pb-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[108px] rounded-xl" />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
