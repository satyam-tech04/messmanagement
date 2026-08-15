/**
 * Validating several students before any of them is created.
 *
 * Creating one student is four writes — a Supabase Auth user, a profile, a
 * student row, optionally a subscription — and the auth call cannot join a
 * Postgres transaction. A batch that fails halfway therefore leaves real
 * accounts behind that no rollback can cleanly remove.
 *
 * So the whole batch is checked here, against every rule and against the rows
 * beside it, before the first account exists. Nothing is written unless
 * everything passes.
 *
 * The rule that only exists because this is a batch: **the same roll number
 * typed twice in one form.** A per-row check cannot see it. Left to the
 * database it surfaces as a unique-index violation on the second row — after an
 * auth user has already been created for it.
 */
import { isValidRollNumber } from "../domain/identity";

/**
 * Most students one submission may create.
 *
 * Each costs one Auth API call, and a serverless request has a hard time limit;
 * past this the CSV import is the right tool. Refusing with that advice beats a
 * request that dies halfway with accounts half-created.
 */
export const MAX_BATCH_SIZE = 25;

export interface StudentDraft {
  readonly rollNumber: string;
  readonly fullName: string;
  readonly phone?: string;
  readonly email?: string;
  readonly block?: string;
  readonly roomNumber?: string;
  readonly planId?: string;
}

export interface BatchRowError {
  /** Index into the ORIGINAL list, so the form can highlight the right row. */
  readonly index: number;
  readonly field: keyof StudentDraft | "form";
  readonly message: string;
}

export interface BatchValidation {
  readonly ok: boolean;
  /** Trimmed, ready to create. Empty whenever `ok` is false. */
  readonly valid: readonly StudentDraft[];
  readonly errors: readonly BatchRowError[];
}

const PHONE = /^\+?[0-9]{7,15}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (v: string | undefined): string => (v ?? "").trim();

/** A row the admin never touched — not an error, just an unused slot. */
function isBlank(row: StudentDraft): boolean {
  return [row.rollNumber, row.fullName, row.phone, row.email, row.block, row.roomNumber].every(
    (v) => clean(v).length === 0,
  );
}

export function validateStudentBatch(
  rows: readonly StudentDraft[],
  /** Roll numbers already enrolled in this mess. Compared case-insensitively. */
  existingRollNumbers: readonly string[],
): BatchValidation {
  const errors: BatchRowError[] = [];
  const valid: StudentDraft[] = [];

  // Blank rows are dropped before anything else: the form shows a fixed number
  // of rows and an admin filling six of ten must not be told off about four.
  const filled = rows.map((row, index) => ({ row, index })).filter(({ row }) => !isBlank(row));

  if (filled.length === 0) {
    return {
      ok: false,
      valid: [],
      errors: [{ index: 0, field: "form", message: "Fill in at least one student." }],
    };
  }

  if (filled.length > MAX_BATCH_SIZE) {
    return {
      ok: false,
      valid: [],
      errors: [
        {
          index: 0,
          field: "form",
          message: `You can add ${MAX_BATCH_SIZE} students at once. For more than that, use the CSV import.`,
        },
      ],
    };
  }

  const taken = new Set(existingRollNumbers.map((r) => r.trim().toLowerCase()));
  const seen = new Map<string, number>();

  for (const { row, index } of filled) {
    const rollNumber = clean(row.rollNumber);
    const fullName = clean(row.fullName);
    const phone = clean(row.phone);
    const email = clean(row.email);

    // One error per row, on the field the admin has to change. Reporting three
    // problems on one row buries the first fix under noise.
    const push = (field: BatchRowError["field"], message: string): void => {
      if (!errors.some((e) => e.index === index)) errors.push({ index, field, message });
    };

    if (rollNumber.length === 0) {
      push("rollNumber", "Enter a roll number — without one they cannot log in.");
    } else if (!isValidRollNumber(rollNumber)) {
      push("rollNumber", "Use letters, digits, dot, underscore or hyphen only.");
    } else {
      const key = rollNumber.toLowerCase();
      if (taken.has(key)) {
        push("rollNumber", `${rollNumber} is already enrolled in this mess.`);
      } else if (seen.has(key)) {
        // Blames the repeat, not the first occurrence — the earlier row is fine
        // and it is this one the admin has to change.
        push(
          "rollNumber",
          `${rollNumber} appears twice — it is already on row ${seen.get(key)! + 1}.`,
        );
      } else {
        seen.set(key, index);
      }
    }

    if (fullName.length < 2) push("fullName", "Enter the student's full name.");
    if (fullName.length > 120) push("fullName", "That name is too long.");
    if (phone && !PHONE.test(phone)) push("phone", "Enter a valid phone number.");
    if (email && !EMAIL.test(email)) push("email", "Enter a valid email address.");

    valid.push({
      rollNumber,
      fullName,
      phone: phone || undefined,
      email: email || undefined,
      block: clean(row.block) || undefined,
      roomNumber: clean(row.roomNumber) || undefined,
      planId: clean(row.planId) || undefined,
    });
  }

  // All or nothing. A partially-valid batch must not be half-created.
  return errors.length > 0 ? { ok: false, valid: [], errors } : { ok: true, valid, errors: [] };
}
