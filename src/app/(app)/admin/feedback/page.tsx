import type { Metadata } from "next";
import Image from "next/image";
import { MessageSquare, Star } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableError } from "@/components/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";
import { averageRating, ratingBreakdown } from "@/core/policies/feedback.policy";
import { addDays, isServiceDate, serviceDateOf, toServiceDate } from "@/core/time";
import { formatServiceDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RangePicker } from "./range-picker";

export const metadata: Metadata = { title: "Feedback · Mess OS" };

const DAYS = 14;

/**
 * What students said about the food.
 *
 * Sorted worst first, deliberately. An owner opening this screen wants the
 * complaints, not a wall of four-star ratings — and a five-star meal needs no
 * action from anybody.
 */
export default async function AdminFeedbackPage({ searchParams }: PageProps<"/admin/feedback">) {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const admin = createAdminClient();
  const today = serviceDateOf(user.timezone, new Date());
  const params = await searchParams;

  const settings = await new SupabaseTenantRepository(supabase, admin).getSettings(user.tenantId);

  if (!settings?.allowFeedback) {
    return (
      <div className="space-y-6">
        <PageHeader title="Feedback" description="What students said about the food." />
        <TableEmpty
          icon={<MessageSquare className="size-6" aria-hidden="true" />}
          title="Feedback is switched off"
          description="Turn it on under Settings → Features and students can rate a meal, add a comment and attach a photo. Anything already left is kept and reappears here."
        />
      </div>
    );
  }

  const requested = typeof params.from === "string" ? params.from : "";
  const from = isServiceDate(requested)
    ? toServiceDate(requested)
    : addDays(toServiceDate(today), -DAYS);

  const { data, error } = await supabase
    .from("meal_feedback")
    .select(
      `id, service_date, meal_slot, rating, comment, photo_path, created_at,
       students!inner ( roll_number, profiles!inner ( full_name ) )`,
    )
    .eq("tenant_id", user.tenantId)
    .gte("service_date", from)
    .lte("service_date", today)
    // Worst first: the complaints are the reason to open this screen.
    .order("rating", { ascending: true })
    .order("service_date", { ascending: false });

  type Row = {
    id: string;
    service_date: string;
    meal_slot: string;
    rating: number;
    comment: string | null;
    photo_path: string | null;
    students: { roll_number: string; profiles: { full_name: string } | null } | null;
  };

  const rows = (data ?? []) as unknown as Row[];
  const ratings = rows.map((r) => r.rating);
  const average = averageRating(ratings);
  const breakdown = ratingBreakdown(ratings);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feedback"
        description="What students said about the food. Ratings never affect a plan, a QR code or the headcount."
        action={<RangePicker from={from} today={today} />}
      />

      {error ? (
        <TableError
          description={`Feedback could not be loaded. ${error.message}`}
          retryHref="/admin/feedback"
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Average rating"
              value={average === null ? "—" : `${average.toFixed(1)} / 5`}
              hint={average === null ? "Nobody has rated a meal yet" : undefined}
              tone={average !== null && average < 3 ? "warning" : "default"}
            />
            <StatCard label="Ratings" value={String(rows.length)} />
            <StatCard
              label="One or two stars"
              value={String(breakdown[1] + breakdown[2])}
              tone={breakdown[1] + breakdown[2] > 0 ? "warning" : "default"}
            />
          </div>

          {rows.length === 0 ? (
            <TableEmpty
              icon={<MessageSquare className="size-6" aria-hidden="true" />}
              title="Nothing said yet"
              description={`No student has rated a meal since ${formatServiceDate(from)}. Ratings appear here as soon as they do.`}
            />
          ) : (
            <div className="space-y-3">
              {rows.map((r) => (
                <Card key={r.id}>
                  <CardContent className="flex flex-col gap-4 py-4 sm:flex-row">
                    {/* Served through an authenticated route: the bucket is
                        private, because a photo of a plate often catches the
                        people around it. */}
                    {r.photo_path ? (
                      <a
                        href={`/api/feedback/${r.id}/photo`}
                        target="_blank"
                        rel="noreferrer"
                        className="focus-visible:ring-ring/50 shrink-0 overflow-hidden rounded-lg border focus-visible:ring-[3px] focus-visible:outline-none"
                      >
                        <Image
                          src={`/api/feedback/${r.id}/photo`}
                          alt={`Photo of ${r.meal_slot.toLowerCase()} on ${r.service_date}`}
                          width={112}
                          height={112}
                          unoptimized
                          className="size-28 object-cover"
                        />
                      </a>
                    ) : null}

                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span
                          className="flex items-center gap-0.5"
                          aria-label={`${r.rating} out of 5`}
                        >
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={cn(
                                "size-4",
                                star <= r.rating
                                  ? "fill-amber-400 text-amber-400"
                                  : "text-muted-foreground/30",
                              )}
                              aria-hidden="true"
                            />
                          ))}
                        </span>
                        <span className="text-sm font-medium">
                          {r.students?.profiles?.full_name ?? "(unknown)"}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {r.students?.roll_number}
                        </span>
                      </div>

                      <p className="text-muted-foreground text-xs">
                        {r.meal_slot.charAt(0) + r.meal_slot.slice(1).toLowerCase()} ·{" "}
                        {formatServiceDate(r.service_date)}
                      </p>

                      {r.comment ? (
                        <p className="text-sm">{r.comment}</p>
                      ) : (
                        <p className="text-muted-foreground text-sm italic">No comment left.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
