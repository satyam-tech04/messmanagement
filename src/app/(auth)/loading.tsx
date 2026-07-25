import { Skeleton } from "@/components/ui/skeleton";

/** Keeps the auth pane from flashing empty while the session is resolved. */
export default function AuthLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="space-y-5">
        <Skeleton className="h-[74px] w-full" />
        <Skeleton className="h-[74px] w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
