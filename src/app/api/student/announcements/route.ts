/**
 * Special-meal announcements for the signed-in student's mess, live today.
 *
 * Shares its reader with the web student home, so the app and the browser show
 * the same notices. Read-only by design (spec B4): there is nothing for a
 * student to acknowledge, dismiss or reply to.
 */
import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { readStudentAnnouncements } from "@/infra/queries/student-announcements";

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: auth.message } },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { user, supabase } = auth.caller;

  return NextResponse.json(
    { announcements: await readStudentAnnouncements(supabase, user) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
