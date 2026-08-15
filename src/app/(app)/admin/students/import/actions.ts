"use server";

/**
 * Importing students from a CSV.
 *
 * Three phases, and the first two write nothing: **upload → preview → commit**.
 * A 300-row file that half-applies and dies on row 147 is a reconciliation job
 * nobody has time for, so the admin confirms a full picture before anything
 * exists.
 *
 * Commit runs in batches driven by the client, because each new student costs a
 * Supabase Auth API call and several hundred sequential calls is far past any
 * serverless request limit. Each batch is its own request, which also means a
 * dropped connection loses one batch rather than the whole import.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { MealSlot } from "@/core/domain/enums";
import {
  previewStudentImport,
  type ExistingStudent,
  type ImportPlan,
  type ImportRow,
} from "@/core/policies/student-import.policy";
import { subscriptionStateOf } from "@/core/policies/subscription-state";
import { serviceDateOf, toServiceDate } from "@/core/time";
import { getSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";
import { parseCsv } from "@/lib/csv";
import { createOneStudent } from "../new/create-one-student";

export interface ImportPreviewState {
  readonly error?: string;
  readonly preview?: {
    readonly rows: readonly ImportRow[];
    readonly summary: {
      create: number;
      update: number;
      subscriptions: number;
      totalPaise: number;
    };
  };
  readonly errors?: readonly { rowNumber: number; column: string; message: string }[];
}

/** Everything the preview needs about the tenant's current state. */
async function loadContext(tenantId: string, timezone: string) {
  const admin = createAdminClient();
  const today = serviceDateOf(timezone, new Date());

  const [{ data: planRows }, { data: studentRows }] = await Promise.all([
    admin
      .from("plans")
      .select("id, name, duration_days, price_paise, included_meal_slots")
      .eq("tenant_id", tenantId)
      .eq("is_active", true),
    admin
      .from("students")
      .select("id, roll_number, subscriptions ( status, start_date, end_date )")
      .eq("tenant_id", tenantId),
  ]);

  const plans: ImportPlan[] = (planRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    durationDays: p.duration_days,
    pricePaise: p.price_paise,
    mealSlots: p.included_meal_slots as MealSlot[],
  }));

  const existing: ExistingStudent[] = (studentRows ?? []).map((s) => {
    const subs = (s.subscriptions ?? []) as unknown as Array<{
      status: string;
      start_date: string;
      end_date: string;
    }>;
    // Only a subscription that is genuinely still running blocks a re-import.
    // A July plan nobody swept to EXPIRED must not make the whole file fail.
    const live = subs.find(
      (x) =>
        x.status === "ACTIVE" &&
        subscriptionStateOf(
          {
            status: x.status,
            startDate: toServiceDate(x.start_date),
            endDate: toServiceDate(x.end_date),
          },
          today,
        ) !== "EXPIRED",
    );
    return {
      rollNumber: s.roll_number.toLowerCase(),
      studentId: s.id,
      activeSubscription: live ? { startDate: live.start_date, endDate: live.end_date } : undefined,
    };
  });

  return { plans, existing, today };
}

export async function previewImport(
  _prev: ImportPreviewState,
  formData: FormData,
): Promise<ImportPreviewState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { error: "Only an admin can import students." };
  }

  const text = String(formData.get("csv") ?? "");
  if (!text.trim()) return { error: "Choose a CSV file first." };

  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (e) {
    // A malformed file is reported as such rather than half-parsed.
    return { error: e instanceof Error ? e.message : "That file could not be read as CSV." };
  }

  const { plans, existing, today } = await loadContext(user.tenantId, user.timezone);
  const result = previewStudentImport({ rows, plans, existing, today });

  if (!result.ok) {
    return {
      error: `${result.errors.length} problem${result.errors.length === 1 ? "" : "s"} found. Nothing has been imported — fix the file and upload it again.`,
      errors: result.errors,
    };
  }

  return { preview: { rows: result.rows, summary: result.summary } };
}

export interface CommitBatchResult {
  readonly created: number;
  readonly updated: number;
  readonly failures: readonly { rollNumber: string; error: string }[];
  /**
   * Only the students with no usable mobile number on file.
   *
   * Everyone else logs in with their own number and needs nothing handed over,
   * which is the entire point — a few hundred passwords cannot be distributed.
   * These few can, so they are the only ones returned.
   */
  readonly needsPassword: readonly {
    rollNumber: string;
    fullName: string;
    temporaryPassword: string;
  }[];
}

const batchSchema = z.object({
  rows: z.string(),
  offset: z.coerce.number().int().min(0),
});

/**
 * Writes one batch of already-validated rows.
 *
 * The rows are re-validated against the database here, not trusted from the
 * client: the preview may be minutes old, and a roll number could have been
 * taken by the bulk form in between.
 */
export async function commitImportBatch(
  _prev: CommitBatchResult | undefined,
  formData: FormData,
): Promise<CommitBatchResult> {
  const user = await getSessionUser();
  if (!user || (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN")) {
    return {
      created: 0,
      updated: 0,
      failures: [{ rollNumber: "—", error: "Not authorised." }],
      needsPassword: [],
    };
  }

  const parsed = batchSchema.safeParse({
    rows: formData.get("rows"),
    offset: formData.get("offset"),
  });
  if (!parsed.success) {
    return {
      created: 0,
      updated: 0,
      failures: [{ rollNumber: "—", error: "Bad batch." }],
      needsPassword: [],
    };
  }

  const batch = JSON.parse(parsed.data.rows) as ImportRow[];
  const admin = createAdminClient();
  const actor = {
    tenantId: user.tenantId,
    tenantSlug: user.tenantSlug,
    timezone: user.timezone,
    actorProfileId: user.actorProfileId,
  };

  let created = 0;
  let updated = 0;
  const failures: { rollNumber: string; error: string }[] = [];
  const needsPassword: { rollNumber: string; fullName: string; temporaryPassword: string }[] = [];

  // Sequential: these are rate-limited Auth calls, and firing twenty at once is
  // the reliable way to have some rejected.
  for (const row of batch) {
    try {
      if (row.action === "CREATE") {
        const result = await createOneStudent(admin, actor, {
          rollNumber: row.student.rollNumber,
          fullName: row.student.fullName,
          phone: row.student.phone,
          email: row.student.email,
          block: row.student.block,
          roomNumber: row.student.roomNumber,
          planId: row.subscription?.planId,
          planStartDate: row.subscription?.startDate,
        });
        if (!result.ok) {
          failures.push({ rollNumber: row.student.rollNumber, error: result.error });
          continue;
        }
        created++;
        // Everyone with a mobile number logs in with it and needs nothing
        // handed over. Only the exceptions are carried back to the screen.
        if (!result.passwordIsPhone) {
          needsPassword.push({
            rollNumber: result.rollNumber,
            fullName: result.fullName,
            temporaryPassword: result.temporaryPassword,
          });
        }

        // `createOneStudent` prices from the plan's list price; the file may
        // carry a discount, and what the student actually paid is the number a
        // fee dispute is settled against.
        if (row.subscription && row.subscription.pricePaise !== undefined) {
          await admin
            .from("subscriptions")
            .update({
              price_paise_snapshot: row.subscription.pricePaise,
              end_date: row.subscription.endDate,
              status: row.subscription.status,
            })
            .eq("tenant_id", user.tenantId)
            .eq("student_id", result.studentId);
        }
      } else {
        // An existing student: update their details, never their subscription.
        const { data: student } = await admin
          .from("students")
          .select("profile_id")
          .eq("tenant_id", user.tenantId)
          .eq("id", row.studentId!)
          .maybeSingle();

        if (!student) {
          failures.push({ rollNumber: row.student.rollNumber, error: "Student no longer exists." });
          continue;
        }

        await admin
          .from("students")
          .update({
            block: row.student.block ?? null,
            room_number: row.student.roomNumber ?? null,
            status: row.student.status,
            ...(row.student.joinedAt ? { joined_at: row.student.joinedAt } : {}),
          })
          .eq("tenant_id", user.tenantId)
          .eq("id", row.studentId!);

        await admin
          .from("profiles")
          .update({
            full_name: row.student.fullName,
            phone: row.student.phone ?? null,
            email: row.student.email ?? null,
          })
          .eq("tenant_id", user.tenantId)
          .eq("id", student.profile_id);

        updated++;
      }
    } catch (e) {
      failures.push({
        rollNumber: row.student.rollNumber,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "STUDENTS_IMPORTED",
    entityType: "students",
    entityId: null,
    after: { offset: parsed.data.offset, created, updated, failed: failures.length },
  });

  revalidatePath("/admin/students");
  return { created, updated, failures, needsPassword };
}
