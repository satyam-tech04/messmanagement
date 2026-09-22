import type { Metadata } from "next";
import { BellOff, Send } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableEmpty, TableError, TableShell } from "@/components/data-table";
import { requireSessionUser } from "@/infra/auth/session";
import { isPushConfigured } from "@/infra/push/fcm";
import {
  readNotificationAudience,
  readRecentNotifications,
  type NotificationAudience,
  type SentNotificationRow,
} from "@/infra/queries/notification-recipients";
import { createAdminClient } from "@/infra/supabase/admin";
import { pageTitle } from "@/lib/app-info";
import { ComposeForm } from "./compose-form";

export const metadata: Metadata = { title: pageTitle("Notifications") };

/** What each kind is called on this screen, rather than its enum name. */
const KIND_LABELS: Record<string, string> = {
  ANNOUNCEMENT: "Announcement",
  ABSENCE_DECISION: "Away request decided",
  PLAN_REMINDER: "Plan reminder",
  MENU_PUBLISHED: "New menu",
};

/**
 * Sending a notification by hand, and what has been sent lately (D-34).
 *
 * Everything else that notifies happens as a side effect of doing something —
 * posting an announcement, deciding an away request. This is the screen for the
 * things that do not fit those: a gas cylinder that ran out, dinner delayed an
 * hour, a hostel-wide notice at short notice.
 */
export default async function AdminNotificationsPage() {
  const user = await requireSessionUser();
  const admin = createAdminClient();
  const configured = isPushConfigured();

  let audience: NotificationAudience = { rows: [], reachable: 0 };
  let recent: readonly SentNotificationRow[] = [];
  let error: string | null = null;

  try {
    [audience, recent] = await Promise.all([
      readNotificationAudience(admin, user.tenantId),
      readRecentNotifications(admin, user.tenantId),
    ]);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Unknown error.";
  }

  const withoutApp = audience.rows.filter((r) => r.deviceCount === 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Send a message to your students' phones — everyone, or the few it concerns."
      />

      {/* Said once, plainly, at the top: without this nothing on the page can
          deliver anything, and an admin typing a careful message deserves to
          know that before they press send rather than after. */}
      {!configured ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-50 p-4 text-sm dark:bg-amber-950/40"
        >
          <BellOff className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Push is not switched on yet
            </p>
            <p className="text-amber-800 dark:text-amber-300/90">
              This deployment has no Firebase credentials, so nothing sent from here will reach
              anyone. Everything else on this page works; it is waiting on configuration, not on
              you.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Students"
          value={String(audience.rows.length)}
          hint="Everyone currently eating here."
        />
        <StatCard
          label="Reachable"
          value={String(audience.reachable)}
          hint="Have the app installed and announcements switched on."
        />
        <StatCard
          label="No app yet"
          value={String(withoutApp)}
          hint={
            withoutApp === 0
              ? "Everyone has it installed."
              : "These students cannot be notified at all."
          }
        />
      </div>

      {error ? (
        <TableError
          description={`Students could not be loaded. ${error}`}
          retryHref="/admin/notifications"
        />
      ) : audience.rows.length === 0 ? (
        <TableEmpty
          icon={<Send className="size-6" aria-hidden="true" />}
          title="No students to notify"
          description="Add students to this mess and they will appear here once they have signed in on the app."
        />
      ) : (
        <div className="rounded-xl border p-4 sm:p-6">
          <ComposeForm rows={audience.rows} tenantName={user.tenantName} />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Recently sent</h2>

        {recent.length === 0 ? (
          <TableEmpty
            icon={<Send className="size-6" aria-hidden="true" />}
            title="Nothing sent yet"
            description="Notifications you send, and the ones sent automatically when you post an announcement or decide an away request, are listed here."
          />
        ) : (
          <TableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>What</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">{KIND_LABELS[row.kind] ?? row.kind}</TableCell>
                    <TableCell className="text-sm tabular-nums">{row.sentCount}</TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {row.failedCount > 0 ? (
                        <span className="text-muted-foreground">{row.failedCount}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(row.createdAt).toLocaleString("en-IN", {
                        timeZone: user.timezone,
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
        )}
      </section>
    </div>
  );
}
