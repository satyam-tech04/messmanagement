/**
 * Rating a meal.
 *
 * The policy is the authority on all of it — that feedback is switched on for
 * this mess, that the rating is 1–5, that the date is not in the future and not
 * older than the lookback window. Checked server-side rather than merely hidden
 * in the UI, because a disabled feature that a request can still reach is not
 * disabled.
 *
 * One verdict per student per meal: the write upserts on
 * `(tenant, student, service_date, meal_slot)`, so resubmitting replaces rather
 * than accumulating.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { ALL_MEAL_SLOTS } from "@/core/domain/enums";
import { parseFeedbackDraft } from "@/core/policies/feedback.policy";
import { isErr } from "@/core/result";
import { serviceDateOf, toServiceDate } from "@/core/time";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { readStudentFeedback } from "@/infra/queries/student-feedback";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";

const schema = z.object({
  rating: z.coerce.number(),
  comment: z.string().max(1000).optional(),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealSlot: z.enum(ALL_MEAL_SLOTS),
});

function fail(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);
  const { user, supabase } = auth.caller;

  return NextResponse.json(await readStudentFeedback(supabase, user), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);
  const { user, supabase } = auth.caller;

  if (!user.studentId) return fail("FORBIDDEN", "Only a student can rate a meal.", 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_FAILED", "Malformed request.", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("VALIDATION_FAILED", "Check your rating.", 400);

  const admin = createAdminClient();
  const settings = await new SupabaseTenantRepository(supabase, admin).getSettings(user.tenantId);
  if (!settings) return fail("INFRASTRUCTURE_ERROR", "Try again in a moment.", 503);

  const draft = parseFeedbackDraft({
    actorRole: user.role,
    featureEnabled: settings.allowFeedback,
    rating: parsed.data.rating,
    comment: parsed.data.comment ?? "",
    serviceDate: toServiceDate(parsed.data.serviceDate),
    mealSlot: parsed.data.mealSlot,
    today: serviceDateOf(user.timezone, new Date()),
  });

  if (isErr(draft)) {
    return fail(
      draft.error.code,
      draft.error.message,
      draft.error.code === "FORBIDDEN" ? 403 : 400,
    );
  }

  const { error } = await supabase.from("meal_feedback").upsert(
    {
      tenant_id: user.tenantId,
      student_id: user.studentId,
      service_date: draft.value.serviceDate,
      meal_slot: draft.value.mealSlot,
      rating: draft.value.rating,
      comment: draft.value.comment,
    },
    { onConflict: "tenant_id,student_id,service_date,meal_slot" },
  );

  if (error) return fail("INFRASTRUCTURE_ERROR", "Could not save that. Try again.", 503);

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
