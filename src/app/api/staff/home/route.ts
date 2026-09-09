/**
 * Today's counter totals for the mobile scanner.
 *
 * Shares its reader with the web staff page, so both agree on what "served
 * today" means — including that a reversed meal never happened.
 *
 * It also hands back the `deviceId` the audit trail should carry. The client
 * could invent one, but then a scan recorded from the app would be untraceable
 * to the same counter as one recorded from the web, and the label is only
 * useful if it is consistent. The client never sees the profile id it is
 * derived from.
 */
import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { readStaffHome } from "@/infra/queries/staff-home";

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: auth.message } },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { user, supabase } = auth.caller;

  // Same rule as `/api/qr/verify`: the counter is staff and above. A student
  // must not be able to read how many people the mess served today.
  if (user.role !== "STAFF" && user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Only counter staff can see this." } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(await readStaffHome(supabase, user), {
    headers: { "Cache-Control": "no-store" },
  });
}
