/**
 * The signed-in student's subscription history.
 *
 * Shares its reader with the web plan page. The live state is derived from the
 * dates rather than read from the status column — a student must be told the
 * truth, not the last thing a sweep happened to write.
 */
import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { readStudentPlan } from "@/infra/queries/student-plan";

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: auth.message } },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { user, supabase } = auth.caller;

  if (user.role !== "STUDENT" || !user.studentId) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Only a student has a plan." } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(await readStudentPlan(supabase, user), {
    headers: { "Cache-Control": "no-store" },
  });
}
