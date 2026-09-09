/**
 * Withdraw an absence the student asked for.
 *
 * Ownership is enforced in the statement itself: the update carries
 * `student_id` in its WHERE clause, so a student cannot cancel someone else's
 * absence even if they guess an id. The status predicate does the rest — only a
 * live request can be withdrawn, and a row already CREDITED must stay put.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseMessCutRepository } from "@/infra/supabase/repositories";

const uuid = z.string().uuid();

export async function POST(
  request: Request,
  context: RouteContext<"/api/student/absences/[id]/cancel">,
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: auth.message } },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { user } = auth.caller;

  if (user.role !== "STUDENT" || !user.studentId) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Only a student can withdraw this." } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { id } = await context.params;
  if (!uuid.safeParse(id).success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Unknown request." } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const cancelled = await new SupabaseMessCutRepository(createAdminClient()).cancel(
    user.tenantId,
    user.studentId,
    id,
  );

  if (!cancelled) {
    return NextResponse.json(
      {
        error: {
          code: "CONFLICT",
          message: "That request can no longer be withdrawn.",
        },
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json({ absence: cancelled }, { headers: { "Cache-Control": "no-store" } });
}
