"use server";

/**
 * A student marking themselves out of a meal, or away for a period.
 *
 * The action does what §"no business logic in Server Actions" allows and no
 * more: parse with Zod, build the tenant context from the *session*, call one
 * use case, map the result. Every rule — notice, allowance, whether the mess
 * permits any of this — lives in `absence.policy.ts` and is tested there.
 *
 * Note what is NOT read from the form: the student id. It comes from the
 * session, so no amount of tampering lets one student cancel another's meals.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ALL_MEAL_SLOTS, type MealSlot } from "@/core/domain/enums";
import { requestAbsenceForStudent } from "@/core/services/request-absence";
import { toServiceDate } from "@/core/time";
import { getSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import {
  SupabaseMessCutRepository,
  SupabaseStudentRepository,
  SupabaseTenantRepository,
} from "@/infra/supabase/repositories";

export interface AbsenceActionState {
  readonly error?: string;
  readonly success?: string;
}

/** `YYYY-MM-DD`, as a date input submits it. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

const schema = z.object({
  kind: z.enum(["SKIP", "AWAY"]),
  dateFrom: isoDate,
  dateTo: isoDate,
});

export async function requestAbsence(
  _prev: AbsenceActionState,
  formData: FormData,
): Promise<AbsenceActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  const parsed = schema.safeParse({
    kind: formData.get("kind"),
    dateFrom: formData.get("dateFrom"),
    // A single-day skip submits only a start date.
    dateTo: formData.get("dateTo") || formData.get("dateFrom"),
  });
  if (!parsed.success) return { error: "Choose the days you will be away." };

  const mealSlots = ALL_MEAL_SLOTS.filter(
    (slot) => formData.get(`slot_${slot}`) === "on",
  ) as MealSlot[];

  const admin = createAdminClient();
  const result = await requestAbsenceForStudent(
    user,
    {
      kind: parsed.data.kind,
      dateFrom: toServiceDate(parsed.data.dateFrom),
      dateTo: toServiceDate(parsed.data.dateTo),
      mealSlots,
    },
    {
      tenants: new SupabaseTenantRepository(admin, admin),
      students: new SupabaseStudentRepository(admin),
      messCuts: new SupabaseMessCutRepository(admin),
      now: () => new Date(),
    },
  );

  if (!result.ok) return { error: result.error.message };

  // The headcount is the kitchen's number, and it moved.
  revalidatePath("/student/absences");
  revalidatePath("/student");
  revalidatePath("/admin/absences");
  revalidatePath("/admin/headcount");

  const wording =
    result.value.status === "PENDING"
      ? "Request sent. The mess office will review it — you will see it here once they do."
      : "Done. You are marked out for those meals and the kitchen will not cook for you.";

  return { success: wording };
}

export async function cancelAbsence(
  _prev: AbsenceActionState,
  formData: FormData,
): Promise<AbsenceActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  if (user.role !== "STUDENT" || !user.studentId) {
    return { error: "Only a student can withdraw their own request." };
  }

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "That request could not be found." };

  const admin = createAdminClient();
  // The repository scopes the UPDATE by tenant AND student, so a guessed id
  // belonging to someone else simply matches no rows.
  const cancelled = await new SupabaseMessCutRepository(admin).cancel(
    user.tenantId,
    user.studentId,
    id.data,
  );

  if (!cancelled) {
    return {
      error:
        "That request can no longer be withdrawn. It may already have been decided — ask the mess office.",
    };
  }

  revalidatePath("/student/absences");
  revalidatePath("/student");
  revalidatePath("/admin/absences");
  revalidatePath("/admin/headcount");

  return { success: "Withdrawn. You are expected at those meals again." };
}
