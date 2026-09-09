/**
 * Projected against served, per meal, for the counter.
 *
 * Shares its reader with the web live-count page, so both honour the rule that
 * a locked snapshot wins — the number the kitchen cooked to must not move
 * afterwards.
 */
import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { readStaffCounts } from "@/infra/queries/staff-counts";

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: auth.message } },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { user, supabase } = auth.caller;

  if (user.role !== "STAFF" && user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Only counter staff can see this." } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const counts = await readStaffCounts(supabase, user);
  if (!counts) {
    return NextResponse.json(
      {
        error: {
          code: "INFRASTRUCTURE_ERROR",
          message: "Meal times are not configured. Ask the mess admin to set them up.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(counts, { headers: { "Cache-Control": "no-store" } });
}
