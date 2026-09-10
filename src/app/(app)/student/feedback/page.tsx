import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { TableEmpty } from "@/components/data-table";
import { requireSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";
import { addDays, serviceDateOf, toServiceDate } from "@/core/time";
import { formatServiceDate } from "@/lib/format";
import { FeedbackForm, type FeedbackTarget } from "./feedback-form";
import { pageTitle } from "@/lib/app-info";

export const metadata: Metadata = { title: pageTitle("Feedback") };

/**
 * Which meals a student may comment on.
 *
 * The meals they were actually recorded as eating, over the last few days. It
 * would be simpler to offer every slot on the calendar, but a rating for a meal
 * somebody never had tells the kitchen nothing, and the attendance rows are
 * already there.
 */
export default async function StudentFeedbackPage() {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const admin = createAdminClient();
  const today = serviceDateOf(user.timezone, new Date());

  const settings = await new SupabaseTenantRepository(supabase, admin).getSettings(user.tenantId);

  if (!settings?.allowFeedback) {
    return (
      <div className="space-y-6">
        <PageHeader title="Feedback" description="Tell the mess what you thought." />
        <TableEmpty
          icon={<MessageSquare className="size-6" aria-hidden="true" />}
          title="Feedback is not being collected"
          description="Your mess has this switched off at the moment. Speak to the mess office if you want to tell them something."
        />
      </div>
    );
  }

  const since = addDays(toServiceDate(today), -7);

  const [attendanceRes, existingRes] = await Promise.all([
    supabase
      .from("attendance")
      .select("service_date, meal_slot")
      .eq("tenant_id", user.tenantId)
      .gte("service_date", since)
      .lte("service_date", today)
      // A reversed meal never happened, so there is nothing to rate.
      .is("reversed_at", null)
      .order("service_date", { ascending: false }),
    supabase
      .from("meal_feedback")
      .select("service_date, meal_slot, rating, comment")
      .eq("tenant_id", user.tenantId)
      .gte("service_date", since),
  ]);

  const existing = new Map(
    (existingRes.data ?? []).map((f) => [`${f.service_date}|${f.meal_slot}`, f]),
  );

  const targets: FeedbackTarget[] = (attendanceRes.data ?? []).map((a) => {
    const found = existing.get(`${a.service_date}|${a.meal_slot}`);
    const slot = a.meal_slot.charAt(0) + a.meal_slot.slice(1).toLowerCase();
    return {
      serviceDate: a.service_date,
      mealSlot: a.meal_slot,
      label:
        a.service_date === today
          ? `${slot} today`
          : `${slot}, ${formatServiceDate(a.service_date)}`,
      existingRating: found?.rating ?? null,
      existingComment: found?.comment ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feedback"
        description="Rate a meal you have had in the last week. The mess office reads it."
      />
      {targets.length === 0 ? (
        <TableEmpty
          icon={<MessageSquare className="size-6" aria-hidden="true" />}
          title="No meals to rate yet"
          description="Once you have been served at the counter, the meal appears here for a week and you can tell the mess what you thought."
        />
      ) : (
        <FeedbackForm targets={targets} />
      )}
    </div>
  );
}
