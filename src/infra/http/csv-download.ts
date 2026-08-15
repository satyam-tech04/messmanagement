import "server-only";

import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";
import { toCsvFile } from "@/lib/csv";

/**
 * The shared shape of every CSV export.
 *
 * Three things must be true of all of them, and doing each by hand in every
 * route is how one of them ends up missing the third:
 *
 *   1. **Admin only.** These files carry names, rooms, phone numbers and what
 *      each student paid.
 *   2. **Audit-logged.** Downloading the roster is a data-protection event, and
 *      "who took a copy of this, and when" must be answerable.
 *   3. **Never cached.** A file of personal data must not sit in a proxy or a
 *      browser cache after the tab is closed.
 */
export async function csvDownload(
  action: string,
  filename: (user: SessionUser) => string,
  build: (user: SessionUser) => Promise<{ rows: string[][]; meta?: Record<string, unknown> }>,
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Not signed in", { status: 401 });
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return new NextResponse("Only an admin can export data", { status: 403 });
  }

  let payload: { rows: string[][]; meta?: Record<string, unknown> };
  try {
    payload = await build(user);
  } catch (e) {
    return new NextResponse(
      `Could not build the export: ${e instanceof Error ? e.message : "unknown error"}`,
      { status: 500 },
    );
  }

  const admin = createAdminClient();
  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action,
    entityType: "export",
    entityId: null,
    after: { rows: payload.rows.length - 1, at: new Date().toISOString(), ...payload.meta },
  });

  return new NextResponse(toCsvFile(payload.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename(user)}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

/** Paise to the plain rupee string a spreadsheet will treat as a number. */
export function rupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
