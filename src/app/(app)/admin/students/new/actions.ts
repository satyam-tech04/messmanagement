"use server";

/**
 * Create a student and issue their credentials (decision D-02).
 *
 * Four things must happen together: an auth user, a profile, a student row, and
 * (optionally) an active subscription. Postgres cannot span the auth schema in
 * one transaction from here, so the ordering below is chosen so that a failure
 * at any step leaves nothing half-created that a retry would trip over — and
 * anything that does get orphaned is cleaned up explicitly.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isValidRollNumber, normalizeRollNumber } from "@/core/domain/identity";
// Only the validator and its types — a "use server" module may export nothing
// but async functions, so the UI imports MAX_BATCH_SIZE from the policy direct.
import {
  validateStudentBatch,
  type BatchRowError,
  type StudentDraft,
} from "@/core/policies/student-batch.policy";
import { createAdminClient } from "@/infra/supabase/admin";
import { createClient } from "@/infra/supabase/server";
import { getSessionUser } from "@/infra/auth/session";
import { createOneStudent } from "./create-one-student";

const schema = z.object({
  rollNumber: z
    .string()
    .trim()
    .min(1, "Roll number is required")
    .refine(isValidRollNumber, "Use letters, digits, dot, underscore or hyphen only"),
  fullName: z.string().trim().min(2, "Enter the student's full name").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, "Enter a valid phone number")
    .optional()
    .or(z.literal("")),
  email: z.email("Enter a valid email").optional().or(z.literal("")),
  block: z.string().trim().max(40).optional().or(z.literal("")),
  roomNumber: z.string().trim().max(40).optional().or(z.literal("")),
  planId: z.string().uuid().optional().or(z.literal("")),
});

export interface CreateStudentState {
  readonly error?: string;
  readonly fieldErrors?: Record<string, string>;
  readonly created?: {
    readonly rollNumber: string;
    readonly fullName: string;
    readonly temporaryPassword: string;
    /** Set when the student was created but the plan assignment failed. */
    readonly planWarning?: string;
  };
}

export async function createStudent(
  _prev: CreateStudentState,
  formData: FormData,
): Promise<CreateStudentState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { error: "Only an admin can add students." };
  }

  const parsed = schema.safeParse({
    rollNumber: formData.get("rollNumber"),
    fullName: formData.get("fullName"),
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    block: formData.get("block") ?? "",
    roomNumber: formData.get("roomNumber") ?? "",
    planId: formData.get("planId") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }

  const input = parsed.data;
  const roll = normalizeRollNumber(input.rollNumber);
  const admin = createAdminClient();
  const supabase = await createClient();

  // Reject a duplicate before creating an auth user, so a retry after a typo
  // does not leave an orphaned account behind.
  const { data: existing } = await supabase
    .from("students")
    .select("id")
    .eq("tenant_id", user.tenantId)
    .ilike("roll_number", roll)
    .maybeSingle();

  if (existing) {
    return {
      error: `Roll number ${input.rollNumber} already exists in this mess.`,
      fieldErrors: { rollNumber: "Already in use" },
    };
  }

  const result = await createOneStudent(
    admin,
    {
      tenantId: user.tenantId,
      tenantSlug: user.tenantSlug,
      timezone: user.timezone,
      actorProfileId: user.actorProfileId,
    },
    {
      rollNumber: input.rollNumber,
      fullName: input.fullName,
      phone: input.phone || undefined,
      email: input.email || undefined,
      block: input.block || undefined,
      roomNumber: input.roomNumber || undefined,
      planId: input.planId || undefined,
    },
  );

  if (!result.ok) return { error: result.error };

  revalidatePath("/admin/students");

  // Returned once, shown once. The password is not stored anywhere readable —
  // if the admin loses it before handing it over, they reset it rather than
  // recovering it.
  return {
    created: {
      rollNumber: result.rollNumber,
      fullName: result.fullName,
      temporaryPassword: result.temporaryPassword,
      planWarning: result.planWarning,
    },
  };
}

// ---------------------------------------------------------------------------
// Bulk entry — several students typed into one form, saved together.
// ---------------------------------------------------------------------------

export interface BulkCreatedRow {
  readonly rollNumber: string;
  readonly fullName: string;
  readonly temporaryPassword: string;
  readonly planWarning?: string;
}

export interface BulkCreateState {
  readonly error?: string;
  /** Keyed by row index, so the form can highlight the exact cell. */
  readonly rowErrors?: readonly BatchRowError[];
  readonly created?: readonly BulkCreatedRow[];
  /** Rows whose write failed after validation passed. */
  readonly failed?: readonly { readonly rollNumber: string; readonly error: string }[];
}

/** Reads `row-<i>-<field>` inputs back into an ordered list of drafts. */
function readRows(formData: FormData): StudentDraft[] {
  const rows: StudentDraft[] = [];
  for (let i = 0; ; i++) {
    if (!formData.has(`row-${i}-rollNumber`)) break;
    rows.push({
      rollNumber: String(formData.get(`row-${i}-rollNumber`) ?? ""),
      fullName: String(formData.get(`row-${i}-fullName`) ?? ""),
      phone: String(formData.get(`row-${i}-phone`) ?? ""),
      email: String(formData.get(`row-${i}-email`) ?? ""),
      block: String(formData.get(`row-${i}-block`) ?? ""),
      roomNumber: String(formData.get(`row-${i}-roomNumber`) ?? ""),
    });
  }
  return rows;
}

export async function createStudentsBulk(
  _prev: BulkCreateState,
  formData: FormData,
): Promise<BulkCreateState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { error: "Only an admin can add students." };
  }

  const rows = readRows(formData);
  // One plan for the whole batch. Everyone typed into a form at once is
  // normally an intake joining the same plan on the same day, and a per-row
  // plan column would make the form unusably wide for the rare exception —
  // which is what the student's own page is for.
  const planId = String(formData.get("planId") ?? "");

  const supabase = await createClient();
  // Every roll number in the mess, not just the ones being added: the batch
  // must be checked against what exists AND against itself, and one text column
  // for a few hundred students is a trivial payload.
  const { data: enrolled, error: readError } = await supabase
    .from("students")
    .select("roll_number")
    .eq("tenant_id", user.tenantId);

  if (readError) {
    // Fail closed. Creating logins without knowing which roll numbers are taken
    // risks a duplicate that only surfaces at the counter.
    return { error: `Could not check existing roll numbers: ${readError.message}` };
  }

  const validation = validateStudentBatch(
    rows,
    (enrolled ?? []).map((r) => r.roll_number),
  );

  if (!validation.ok) {
    const formLevel = validation.errors.find((e) => e.field === "form");
    return {
      error: formLevel?.message ?? "Check the highlighted rows.",
      rowErrors: validation.errors,
    };
  }

  const admin = createAdminClient();
  const actor = {
    tenantId: user.tenantId,
    tenantSlug: user.tenantSlug,
    timezone: user.timezone,
    actorProfileId: user.actorProfileId,
  };

  const created: BulkCreatedRow[] = [];
  const failed: { rollNumber: string; error: string }[] = [];

  // Sequential, not Promise.all. These are Auth API calls against a rate-limited
  // endpoint, and firing 25 at once is the reliable way to have some rejected.
  // Every row is attempted even after one fails: the successes are real students
  // who now exist, and the admin needs the full picture in one pass.
  for (const draft of validation.valid) {
    const result = await createOneStudent(admin, actor, {
      ...draft,
      planId: planId || undefined,
    });

    if (result.ok) {
      created.push({
        rollNumber: result.rollNumber,
        fullName: result.fullName,
        temporaryPassword: result.temporaryPassword,
        planWarning: result.planWarning,
      });
    } else {
      failed.push({ rollNumber: result.rollNumber, error: result.error });
    }
  }

  revalidatePath("/admin/students");

  return {
    created,
    failed: failed.length > 0 ? failed : undefined,
    error:
      failed.length > 0
        ? `${created.length} added, ${failed.length} could not be created. Those rows were left out — fix and add them again.`
        : undefined,
  };
}
