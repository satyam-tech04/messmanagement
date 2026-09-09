/**
 * A student's absences: the history, the rules, and requesting a new one.
 *
 * The POST calls the same `requestAbsenceForStudent` use case as the web form,
 * so every rule holds identically — the monthly cap, the advance-notice window,
 * that a SKIP may not cross a month boundary, that an AWAY expands to every
 * slot the mess serves, and that the range must sit inside the plan.
 *
 * It is idempotent by way of the database: a partial unique index means a
 * duplicate live request raises 23505, which the use case catches, re-reads and
 * returns as success. A student double-tapping on a slow connection gets one
 * absence, not two.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { ALL_MEAL_SLOTS } from "@/core/domain/enums";
import { isErr } from "@/core/result";
import { toServiceDate } from "@/core/time";
import { requestAbsenceForStudent } from "@/core/services/request-absence";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { readStudentAbsences } from "@/infra/queries/student-absences";
import { createAdminClient } from "@/infra/supabase/admin";
import { createRepositories } from "@/infra/supabase/repositories";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

const schema = z.object({
  kind: z.enum(["SKIP", "AWAY"]),
  dateFrom: isoDate,
  // A single-day skip sends one date; the range collapses to it.
  dateTo: isoDate.optional(),
  mealSlots: z.array(z.enum(ALL_MEAL_SLOTS)).default([]),
});

function fail(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details: details ?? null } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);
  const { user, supabase } = auth.caller;

  const data = await readStudentAbsences(supabase, user);
  if (!data) return fail("NOT_FOUND", "Absences are not available.", 404);

  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return fail(auth.code, auth.message, auth.status);
  const { user, supabase } = auth.caller;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_FAILED", "Malformed request.", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail(
      "VALIDATION_FAILED",
      parsed.error.issues[0]?.message ?? "Check the dates and try again.",
      400,
    );
  }

  const repos = createRepositories(supabase, createAdminClient());
  const result = await requestAbsenceForStudent(
    user,
    {
      kind: parsed.data.kind,
      dateFrom: toServiceDate(parsed.data.dateFrom),
      dateTo: toServiceDate(parsed.data.dateTo ?? parsed.data.dateFrom),
      mealSlots: parsed.data.mealSlots,
    },
    {
      tenants: repos.tenants,
      students: repos.students,
      messCuts: repos.messCuts,
      now: () => new Date(),
    },
  );

  if (isErr(result)) {
    // The domain code is the answer. Statuses are advisory — the client keys on
    // `code`, which is what carries "you have used your cap" versus "that is
    // too late to cancel".
    const status =
      result.error.code === "FORBIDDEN"
        ? 403
        : result.error.code === "CONFLICT"
          ? 409
          : result.error.code === "NOT_FOUND"
            ? 404
            : result.error.code === "INFRASTRUCTURE_ERROR"
              ? 503
              : 400;
    return fail(result.error.code, result.error.message, status, result.error.details);
  }

  return NextResponse.json({ absence: result.value }, { headers: { "Cache-Control": "no-store" } });
}
