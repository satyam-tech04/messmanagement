/**
 * Special-meal announcements live for the signed-in student's mess today.
 *
 * Shared by the web student home and `GET /api/student/announcements`, so the
 * phone and the browser show the same notices on the same day. Before this the
 * query lived inside the web page, and the app had no way to see announcements
 * at all.
 *
 * Filtered by date in the query and again by the policy, so a row that slips
 * through a date edge case still cannot render. Empty — never an error — when
 * the mess has switched announcements off: a disabled feature shows nothing.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { visibleAnnouncements } from "@/core/policies/announcement.policy";
import { serviceDateOf, toServiceDate } from "@/core/time";
import type { SessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import type { Database } from "@/infra/supabase/database.types";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";

export interface LiveAnnouncement {
  readonly id: string;
  readonly title: string;
  readonly body: string | null;
  /** The day the special meal is served, when it is about one particular day. */
  readonly serviceDate: string | null;
  readonly mealSlot: string | null;
}

export async function readStudentAnnouncements(
  supabase: SupabaseClient<Database>,
  user: SessionUser,
): Promise<readonly LiveAnnouncement[]> {
  const settings = await new SupabaseTenantRepository(supabase, createAdminClient()).getSettings(
    user.tenantId,
  );
  if (!settings?.allowAnnouncements) return [];

  const today = serviceDateOf(user.timezone, new Date());

  // RLS limits students to their own mess; the tenant filter is the
  // application layer saying the same thing (rule 8).
  const { data } = await supabase
    .from("announcements")
    .select("id, title, body, service_date, meal_slot, starts_on, ends_on, status")
    .eq("tenant_id", user.tenantId)
    .eq("status", "PUBLISHED")
    .lte("starts_on", today)
    .gte("ends_on", today)
    .order("starts_on", { ascending: false });

  return visibleAnnouncements(
    (data ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      serviceDate: a.service_date,
      mealSlot: a.meal_slot,
      status: a.status,
      startsOn: toServiceDate(a.starts_on),
      endsOn: toServiceDate(a.ends_on),
    })),
    today,
  ).map(({ id, title, body, serviceDate, mealSlot }) => ({
    id,
    title,
    body,
    serviceDate,
    mealSlot,
  }));
}
