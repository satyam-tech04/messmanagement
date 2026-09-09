/**
 * The next few days of meals for the signed-in student.
 *
 * Shares its reader with the web menu page, so both agree on which day is
 * "today" — the mess's day, in the mess's timezone.
 */
import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { readStudentMenu } from "@/infra/queries/student-menu";

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: auth.message } },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { user, supabase } = auth.caller;

  return NextResponse.json(await readStudentMenu(supabase, user), {
    headers: { "Cache-Control": "no-store" },
  });
}
