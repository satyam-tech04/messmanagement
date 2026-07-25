"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STATUSES = ["ALL", "ACTIVE", "GRACE", "BLOCKED", "INACTIVE"] as const;

/**
 * Search and status filter, driven entirely through the URL.
 *
 * Keeping state in the query string rather than component state means a filtered
 * view survives a refresh, can be bookmarked, and can be pasted to a colleague —
 * "the blocked students" is a link, not a set of instructions. It also keeps the
 * table a Server Component, so filtering happens in Postgres rather than by
 * shipping every student to the browser.
 */
export function StudentsFilters({
  initialQuery,
  initialStatus,
}: {
  initialQuery: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(initialQuery);

  // Debounced: a keystroke-per-query would hammer the database and make the
  // table flicker while someone types a roll number.
  useEffect(() => {
    const t = setTimeout(() => {
      if (value === initialQuery) return;
      const next = new URLSearchParams(params.toString());
      if (value) next.set("q", value);
      else next.delete("q");
      next.delete("page"); // a new search must start at page 1
      startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
    }, 300);
    return () => clearTimeout(t);
  }, [value, initialQuery, params, router]);

  function setStatus(status: string) {
    const next = new URLSearchParams(params.toString());
    if (status === "ALL") next.delete("status");
    else next.set("status", status);
    next.delete("page");
    startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-xs">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search name or roll number…"
          aria-label="Search students"
          className="h-10 pr-9 pl-9"
        />
        {pending ? (
          <Loader2
            className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin"
            aria-hidden="true"
          />
        ) : value ? (
          <button
            type="button"
            onClick={() => setValue("")}
            aria-label="Clear search"
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div
        className="bg-muted/60 flex items-center gap-1 overflow-x-auto rounded-lg p-1"
        role="group"
        aria-label="Filter by status"
      >
        {STATUSES.map((s) => {
          const active = initialStatus === s || (s === "ALL" && !initialStatus);
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              aria-pressed={active}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
