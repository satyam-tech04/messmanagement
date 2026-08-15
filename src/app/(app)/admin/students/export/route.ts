/**
 * Exporting the student roster as CSV.
 *
 * Written to be **import-compatible**: the columns and their order come from
 * `IMPORT_COLUMNS`, the same list the importer reads. Export, bulk-edit rooms
 * in Excel, re-import is how a start-of-term reshuffle will actually be done,
 * and that round trip only works if the two cannot drift.
 *
 * Audit-logged without exception. Downloading the roster is a data-protection
 * event — names, rooms, phone numbers and what each student paid, in one file
 * that leaves the system entirely.
 */
import { NextResponse } from "next/server";
import { IMPORT_COLUMNS } from "@/core/policies/student-import.policy";
import { subscriptionStateOf } from "@/core/policies/subscription-state";
import { serviceDateOf, toServiceDate } from "@/core/time";
import { getSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { firstRelated } from "@/infra/supabase/mappers";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";
import { toCsvFile } from "@/lib/csv";

/** Paise back to the rupee string the import accepts. Never a float. */
function rupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Not signed in", { status: 401 });
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return new NextResponse("Only an admin can export students", { status: 403 });
  }

  const admin = createAdminClient();
  const today = serviceDateOf(user.timezone, new Date());

  // Tenant-scoped in the query itself, not merely in the UI that linked here.
  const { data, error } = await admin
    .from("students")
    .select(
      `roll_number, block, room_number, joined_at, status,
       profiles!inner ( full_name, phone, email ),
       subscriptions ( status, start_date, end_date, price_paise_snapshot,
                       plans ( name ) )`,
    )
    .eq("tenant_id", user.tenantId)
    .order("roll_number");

  if (error) {
    return new NextResponse(`Could not read students: ${error.message}`, { status: 500 });
  }

  const rows: string[][] = [[...IMPORT_COLUMNS]];

  for (const student of data ?? []) {
    const profile = firstRelated<{ full_name: string; phone: string | null; email: string | null }>(
      student.profiles as never,
    );

    // The one that still matters today, judged by its dates — nothing marks a
    // finished plan EXPIRED, so trusting the column would export a July plan as
    // this student's current one.
    const subs = (student.subscriptions ?? []) as unknown as Array<{
      status: string;
      start_date: string;
      end_date: string;
      price_paise_snapshot: number;
      plans: unknown;
    }>;
    const current = subs.find(
      (s) =>
        s.status === "ACTIVE" &&
        subscriptionStateOf(
          {
            status: s.status,
            startDate: toServiceDate(s.start_date),
            endDate: toServiceDate(s.end_date),
          },
          today,
        ) !== "EXPIRED",
    );
    const plan = current ? firstRelated<{ name: string }>(current.plans as never) : null;

    rows.push([
      student.roll_number,
      profile?.full_name ?? "",
      profile?.phone ?? "",
      profile?.email ?? "",
      student.block ?? "",
      student.room_number ?? "",
      student.joined_at ?? "",
      student.status,
      plan?.name ?? "",
      current?.start_date ?? "",
      current?.end_date ?? "",
      current ? rupees(current.price_paise_snapshot) : "",
      // Not stored yet — Phase 2's ledger owns payment references. The column
      // is present so the round trip keeps its shape.
      "",
      current?.status ?? "",
    ]);
  }

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "STUDENTS_EXPORTED",
    entityType: "students",
    entityId: null,
    after: { count: rows.length - 1, exportedAt: new Date().toISOString() },
  });

  return new NextResponse(toCsvFile(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="students-${today}.csv"`,
      // This file contains personal data; no cache should keep a copy.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
