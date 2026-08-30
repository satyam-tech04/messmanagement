import type { Metadata } from "next";
import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableError, TableShell } from "@/components/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";
import { announcementStateOf, announcementStateLabel } from "@/core/policies/announcement.policy";
import { serviceDateOf, toServiceDate } from "@/core/time";
import { formatServiceDate } from "@/lib/format";
import {
  ArchiveButton,
  CreateAnnouncementDialog,
  EditAnnouncementDialog,
  type AnnouncementRow,
} from "./announcement-form";

export const metadata: Metadata = { title: "Announcements · Mess OS" };

export default async function AnnouncementsPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const today = serviceDateOf(user.timezone, new Date());

  const settings = await new SupabaseTenantRepository(supabase, createAdminClient()).getSettings(
    user.tenantId,
  );

  if (!settings?.allowAnnouncements) {
    return (
      <div className="space-y-6">
        <PageHeader title="Announcements" description="Tell students about a special meal." />
        <TableEmpty
          icon={<Megaphone className="size-6" aria-hidden="true" />}
          title="Announcements are switched off"
          description="Turn them on under Settings → Features, and you can post a notice that every student sees on their own screen."
        />
      </div>
    );
  }

  const { data, error } = await supabase
    .from("announcements")
    .select("id, title, body, service_date, meal_slot, starts_on, ends_on, status")
    .eq("tenant_id", user.tenantId)
    .order("starts_on", { ascending: false });

  const rows: AnnouncementRow[] = (data ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    serviceDate: a.service_date,
    mealSlot: a.meal_slot,
    startsOn: a.starts_on,
    endsOn: a.ends_on,
    // Derived, not stored — nothing runs to expire one.
    state: announcementStateOf(
      {
        status: a.status,
        startsOn: toServiceDate(a.starts_on),
        endsOn: toServiceDate(a.ends_on),
      },
      today,
    ),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        description="A special meal, a festival lunch. Students see it on their own screen while it is showing, then it stops on its own."
        action={<CreateAnnouncementDialog today={today} />}
      />

      {error ? (
        <TableError
          description={`Announcements could not be loaded. ${error.message}`}
          retryHref="/admin/announcements"
        />
      ) : rows.length === 0 ? (
        <TableEmpty
          icon={<Megaphone className="size-6" aria-hidden="true" />}
          title="Nothing announced yet"
          description="Post a notice when the mess is serving something out of the ordinary — students will see it the next time they open the app."
          action={<CreateAnnouncementDialog today={today} />}
        />
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Announcement</TableHead>
                <TableHead>Meal</TableHead>
                <TableHead>Showing</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id} className={a.state === "ARCHIVED" ? "opacity-60" : undefined}>
                  <TableCell>
                    <p className="font-medium">{a.title}</p>
                    {a.body ? (
                      <p className="text-muted-foreground line-clamp-1 text-xs">{a.body}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {a.serviceDate ? formatServiceDate(a.serviceDate) : "—"}
                    {a.mealSlot ? ` · ${a.mealSlot.toLowerCase()}` : ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm tabular-nums">
                    {formatServiceDate(a.startsOn)} – {formatServiceDate(a.endsOn)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={announcementStateLabel(a.state).toUpperCase()} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <EditAnnouncementDialog announcement={a} today={today} />
                      <ArchiveButton id={a.id} archived={a.state === "ARCHIVED"} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      )}
    </div>
  );
}
