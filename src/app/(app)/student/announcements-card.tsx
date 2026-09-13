import { Megaphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatServiceDate } from "@/lib/format";

import type { LiveAnnouncement } from "@/infra/queries/student-announcements";

/**
 * Special-meal notices, on the one screen a student actually opens.
 *
 * Read-only and nothing else: no acknowledgement, no dismissal, nothing to tap.
 * Per D-19 the student reads it and comes to the mess; everything after that
 * happens offline.
 *
 * Renders `null` when there is nothing live, rather than an empty card. This
 * screen is held up at a counter and every row on it costs attention that
 * belongs to the QR code.
 */
export function AnnouncementsCard({
  announcements,
}: {
  announcements: readonly LiveAnnouncement[];
}) {
  if (announcements.length === 0) return null;

  return (
    <Card className="border-amber-500/30 bg-amber-50/60 dark:bg-amber-950/20">
      <CardContent className="space-y-4 py-5">
        {announcements.map((a) => (
          <div key={a.id} className="flex gap-3">
            <Megaphone
              className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <div className="min-w-0 space-y-1">
              <h3 className="font-semibold text-amber-900 dark:text-amber-200">{a.title}</h3>
              {a.serviceDate || a.mealSlot ? (
                <p className="text-sm text-amber-800/80 dark:text-amber-300/80">
                  {a.serviceDate ? formatServiceDate(a.serviceDate) : null}
                  {a.serviceDate && a.mealSlot ? " · " : null}
                  {a.mealSlot ? a.mealSlot.charAt(0) + a.mealSlot.slice(1).toLowerCase() : null}
                </p>
              ) : null}
              {a.body ? (
                <p className="text-sm whitespace-pre-line text-amber-900/90 dark:text-amber-200/90">
                  {a.body}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
