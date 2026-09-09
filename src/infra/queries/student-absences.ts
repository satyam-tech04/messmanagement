/**
 * Everything the absences screen needs: the history, and the rules the form
 * must obey.
 *
 * The rules travel with the data deliberately. The server enforces all of them
 * regardless — caps, advance notice, which slots a plan covers — but a client
 * that cannot see them can only offer a date picker that accepts anything and
 * then reports a refusal. A student planning a trip home should be shown the
 * earliest date they may choose, not discover it by being told no.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysUsedInMonth, earliestAbsenceDate } from "@/core/policies/absence.policy";
import { subscriptionStateOf } from "@/core/policies/subscription-state";
import { serviceDateOf, toServiceDate } from "@/core/time";
import type { SessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseMessCutRepository, SupabaseTenantRepository } from "@/infra/supabase/repositories";
import type { Database } from "@/infra/supabase/database.types";

export interface AbsenceRow {
  readonly id: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly mealSlots: readonly string[];
  readonly status: string;
  readonly requestedAt: string | null;
  readonly rejectionReason: string | null;
  /** Only a live request can be withdrawn. */
  readonly canCancel: boolean;
}

export interface StudentAbsences {
  readonly today: string;
  readonly enabled: boolean;
  readonly hasActivePlan: boolean;
  readonly allowMealSkipping: boolean;
  readonly allowPartialDaySkip: boolean;
  readonly allowAwayRequests: boolean;
  readonly awayRequiresApproval: boolean;
  readonly cutMaxDaysPerMonth: number;
  readonly daysUsedThisMonth: number;
  readonly awayMaxDays: number;
  readonly plannedSlots: readonly string[];
  readonly earliestSkipDate: string | null;
  readonly earliestAwayDate: string | null;
  readonly planEndDate: string | null;
  readonly history: readonly AbsenceRow[];
}

export async function readStudentAbsences(
  supabase: SupabaseClient<Database>,
  user: SessionUser,
): Promise<StudentAbsences | null> {
  if (!user.studentId) return null;

  const admin = createAdminClient();
  const settings = await new SupabaseTenantRepository(supabase, admin).getSettings(user.tenantId);
  if (!settings) return null;

  const today = serviceDateOf(user.timezone, new Date());
  const cuts = new SupabaseMessCutRepository(admin);

  const [{ data: subscriptions }, history, live] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("id, status, start_date, end_date, included_meal_slots_snapshot")
      .eq("tenant_id", user.tenantId)
      .order("start_date", { ascending: false }),
    cuts.findForStudent(user.tenantId, user.studentId, 50),
    cuts.findLiveInMonth(user.tenantId, user.studentId, today),
  ]);

  const active = (subscriptions ?? []).find(
    (s) =>
      subscriptionStateOf(
        {
          status: s.status,
          startDate: toServiceDate(s.start_date),
          endDate: toServiceDate(s.end_date),
        },
        today,
      ) === "RUNNING",
  );

  return {
    today,
    // Both toggles ship off. A screen for a disabled feature must not merely
    // 404 — it must never appear in the navigation at all.
    enabled: settings.allowMealSkipping || settings.allowAwayRequests,
    hasActivePlan: Boolean(active),
    allowMealSkipping: settings.allowMealSkipping,
    allowPartialDaySkip: settings.allowPartialDaySkip,
    allowAwayRequests: settings.allowAwayRequests,
    awayRequiresApproval: settings.awayRequiresApproval,
    cutMaxDaysPerMonth: settings.cutMaxDaysPerMonth,
    daysUsedThisMonth: daysUsedInMonth(live, today),
    awayMaxDays: settings.awayMaxDays,
    plannedSlots: active?.included_meal_slots_snapshot ?? [],
    earliestSkipDate: earliestAbsenceDate(today, settings.cutAdvanceHours),
    earliestAwayDate: earliestAbsenceDate(today, settings.awayAdvanceHours),
    planEndDate: active?.end_date ?? null,
    history: history.map((row) => ({
      id: row.id,
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
      mealSlots: row.mealSlots,
      status: row.status,
      // Serialised as an instant, not a date: this is when the request was
      // made, which is a moment in time rather than one of the mess's days.
      requestedAt: row.requestedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason ?? null,
      canCancel: row.status === "PENDING" || row.status === "APPROVED",
    })),
  };
}
