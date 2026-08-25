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
import {
  isReservedRollNumber,
  isValidRollNumber,
  normalizeMobile,
  normalizeRollNumber,
} from "@/core/domain/identity";
// Only the validator and its types — a "use server" module may export nothing
// but async functions, so the UI imports MAX_BATCH_SIZE from the policy direct.
import {
  validateStudentBatch,
  type BatchRowError,
  type StudentDraft,
} from "@/core/policies/student-batch.policy";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";
import { allocateRollNumber } from "@/infra/supabase/repositories/tenant.repository";
import { createClient } from "@/infra/supabase/server";
import { getSessionUser } from "@/infra/auth/session";
import { serviceDateOf } from "@/core/time";
import { createOneStudent } from "./create-one-student";

const schema = z.object({
  // Optional here, not because it is optional in the product, but because a
  // mess that auto-assigns roll numbers never renders the field. Which of the
  // two applies is a stored setting, and Zod cannot read it — so presence is
  // enforced below, once the setting is known.
  rollNumber: z
    .string()
    .trim()
    .refine((r) => r === "" || !isReservedRollNumber(r), "That roll number is reserved")
    .refine(
      (r) => r === "" || isValidRollNumber(r),
      "Use letters, digits, dot, underscore or hyphen only",
    )
    .optional()
    .or(z.literal("")),
  fullName: z.string().trim().min(2, "Enter the student's full name").max(120),
  // Required since students began signing in with it. A student without a
  // mobile number has no way into the app at all, so accepting one without it
  // would be creating an account nobody can use.
  phone: z
    .string()
    .trim()
    .min(1, "A mobile number is required — it is how the student signs in")
    .refine((p) => normalizeMobile(p) !== null, "Enter a mobile number with at least 10 digits"),
  email: z.email("Enter a valid email").optional().or(z.literal("")),
  block: z.string().trim().max(40).optional().or(z.literal("")),
  roomNumber: z.string().trim().max(40).optional().or(z.literal("")),
  planId: z.string().uuid().optional().or(z.literal("")),
  planStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid start date")
    .optional()
    .or(z.literal("")),
});

export interface CreateStudentState {
  readonly error?: string;
  readonly fieldErrors?: Record<string, string>;
  readonly created?: {
    readonly rollNumber: string;
    readonly fullName: string;
    readonly temporaryPassword: string;
    readonly passwordIsPhone: boolean;
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
    planStartDate: formData.get("planStartDate") ?? "",
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
  const admin = createAdminClient();
  const supabase = await createClient();

  const settings = await new SupabaseTenantRepository(supabase, admin).getSettings(user.tenantId);

  // Two students sharing a number means neither can sign in — the login flow
  // refuses an ambiguous mobile rather than guessing which account to open.
  // Caught here, before an auth user exists, so the admin sees a field error
  // instead of an orphaned account.
  const mobile = normalizeMobile(input.phone)!;
  const { data: phoneClash } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("tenant_id", user.tenantId)
    .eq("role", "STUDENT")
    .eq("mobile", mobile)
    .maybeSingle();

  if (phoneClash) {
    return {
      error: `That mobile number already belongs to ${phoneClash.full_name}. Two students cannot share one number, because it is how they sign in.`,
      fieldErrors: { phone: "Already in use" },
    };
  }

  let roll: string;
  if (settings?.autoRollNumbers) {
    // Allocated by the database under a row lock, so concurrent enrolments
    // cannot be handed the same number.
    try {
      roll = await allocateRollNumber(admin, user.tenantId);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Could not allocate a roll number." };
    }
  } else {
    if (!input.rollNumber) {
      return {
        error: "Check the highlighted fields.",
        fieldErrors: { rollNumber: "Roll number is required" },
      };
    }
    roll = normalizeRollNumber(input.rollNumber);

    // Reject a duplicate before creating an auth user, so a retry after a typo
    // does not leave an orphaned account behind. Not needed on the auto path:
    // the counter only ever moves forward.
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
      rollNumber: roll,
      fullName: input.fullName,
      phone: input.phone || undefined,
      email: input.email || undefined,
      block: input.block || undefined,
      roomNumber: input.roomNumber || undefined,
      planId: input.planId || undefined,
      planStartDate: input.planStartDate || undefined,
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
      passwordIsPhone: result.passwordIsPhone,
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
  /** False when there was no mobile number, so this one must be handed over. */
  readonly passwordIsPhone: boolean;
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
    // Keyed on the name, not the roll number: a mess that auto-assigns does not
    // render a roll-number input at all, and keying on it would read zero rows
    // and report the form as empty.
    if (!formData.has(`row-${i}-fullName`)) break;
    rows.push({
      rollNumber: String(formData.get(`row-${i}-rollNumber`) ?? ""),
      fullName: String(formData.get(`row-${i}-fullName`) ?? ""),
      phone: String(formData.get(`row-${i}-phone`) ?? ""),
      email: String(formData.get(`row-${i}-email`) ?? ""),
      block: String(formData.get(`row-${i}-block`) ?? ""),
      roomNumber: String(formData.get(`row-${i}-roomNumber`) ?? ""),
      planStartDate: String(formData.get(`row-${i}-planStartDate`) ?? ""),
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
  // One start date for the batch, matching the one plan. An intake entered
  // together normally began eating on the same day, and that day is often not
  // today — the mess has been serving them since before it had this system.
  const planStartDate = String(formData.get("planStartDate") ?? "");

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

  // Same check, for the field that is actually the student's username now. A
  // repeated number makes the login ambiguous and locks out both students.
  const { data: registered, error: mobileError } = await supabase
    .from("profiles")
    .select("mobile")
    .eq("tenant_id", user.tenantId)
    .eq("role", "STUDENT")
    .not("mobile", "is", null);

  if (mobileError) {
    return { error: `Could not check existing mobile numbers: ${mobileError.message}` };
  }

  const admin = createAdminClient();
  const settings = await new SupabaseTenantRepository(supabase, admin).getSettings(user.tenantId);
  const autoRollNumbers = settings?.autoRollNumbers ?? false;

  // The chosen plan's length is what bounds how far any row may backdate, so it
  // is read before validating rather than discovered at write time.
  let planDurationDays: number | undefined;
  if (planId) {
    const { data: plan } = await supabase
      .from("plans")
      .select("duration_days")
      .eq("tenant_id", user.tenantId)
      .eq("id", planId)
      .maybeSingle();
    planDurationDays = plan?.duration_days;
  }

  const validation = validateStudentBatch(
    rows,
    (enrolled ?? []).map((r) => r.roll_number),
    {
      batchStartDate: planStartDate || undefined,
      planDurationDays,
      today: serviceDateOf(user.timezone, new Date()),
      autoRollNumbers,
      existingMobiles: (registered ?? [])
        .map((r) => r.mobile)
        .filter((m): m is string => m !== null),
    },
  );

  if (!validation.ok) {
    const formLevel = validation.errors.find((e) => e.field === "form");
    return {
      error: formLevel?.message ?? "Check the highlighted rows.",
      rowErrors: validation.errors,
    };
  }

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
    // Allocated per row, here rather than before validation, so a batch that
    // fails its checks does not burn numbers off the mess's counter.
    let rollNumber = draft.rollNumber;
    if (autoRollNumbers) {
      try {
        rollNumber = await allocateRollNumber(admin, user.tenantId);
      } catch (e) {
        failed.push({
          rollNumber: draft.fullName,
          error: e instanceof Error ? e.message : "Could not allocate a roll number.",
        });
        continue;
      }
    }

    const result = await createOneStudent(admin, actor, {
      ...draft,
      rollNumber,
      planId: planId || undefined,
      // Already resolved per row by the validator: the row's own date, or the
      // batch default where the row left it blank.
      planStartDate: draft.planStartDate,
    });

    if (result.ok) {
      created.push({
        rollNumber: result.rollNumber,
        fullName: result.fullName,
        temporaryPassword: result.temporaryPassword,
        passwordIsPhone: result.passwordIsPhone,
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
