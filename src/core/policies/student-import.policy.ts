/**
 * Interpreting an uploaded student sheet (see docs/IMPORT-EXPORT.md).
 *
 * This runs once, against a live mess, on a file a non-technical person typed.
 * Nothing is written until every row passes, so this function is the only thing
 * standing between a spreadsheet and several hundred real logins with real
 * money attached — and it must report *everything* wrong in one pass, because
 * an admin fixing a 300-row file one error per upload will give up.
 *
 * Two fields cause lasting damage if wrong:
 *
 *   - the **roll number**, which a student logs in with, and which the database
 *     indexes case-insensitively per tenant
 *   - the **amount paid**, which becomes an immutable `price_paise_snapshot` on
 *     the subscription and is what a fee dispute is settled against
 *
 * Pure: no I/O. The caller supplies the plans and the students that already
 * exist; this decides what would happen and reports it for confirmation.
 */
import { isValidRollNumber } from "../domain/identity";
import { StudentStatus, type MealSlot } from "../domain/enums";
import { addDays, compareServiceDates, toServiceDate, type ServiceDate } from "../time";
import { validateSubscriptionStart } from "./student-admin.policy";

export interface ImportPlan {
  readonly id: string;
  readonly name: string;
  readonly durationDays: number;
  readonly pricePaise: number;
  readonly mealSlots: readonly MealSlot[];
}

export interface ExistingStudent {
  /** Lower-cased, matching `students_tenant_roll_key`. */
  readonly rollNumber: string;
  readonly studentId: string;
  readonly activeSubscription?: { readonly startDate: string; readonly endDate: string };
}

export interface ImportStudentFields {
  readonly rollNumber: string;
  readonly fullName: string;
  readonly phone?: string;
  readonly email?: string;
  readonly block?: string;
  readonly roomNumber?: string;
  readonly joinedAt?: string;
  readonly status: StudentStatus;
}

export interface ImportSubscription {
  readonly planId: string;
  readonly planName: string;
  readonly startDate: ServiceDate;
  readonly endDate: ServiceDate;
  readonly pricePaise: number;
  readonly mealSlots: readonly MealSlot[];
  readonly status: "ACTIVE" | "PENDING_PAYMENT";
  readonly paymentReference?: string;
}

export interface ImportRow {
  /** As numbered in the spreadsheet, where the header is row 1. */
  readonly rowNumber: number;
  readonly action: "CREATE" | "UPDATE";
  readonly studentId?: string;
  readonly student: ImportStudentFields;
  readonly subscription?: ImportSubscription;
  /** Non-blocking notes shown in the preview, e.g. a subscription skipped. */
  readonly warnings: readonly string[];
}

export interface ImportError {
  readonly rowNumber: number;
  readonly column: string;
  readonly message: string;
}

export interface ImportPreview {
  readonly ok: boolean;
  readonly rows: readonly ImportRow[];
  readonly errors: readonly ImportError[];
  readonly summary: {
    readonly create: number;
    readonly update: number;
    readonly subscriptions: number;
    readonly totalPaise: number;
  };
}

export interface ImportRequest {
  /** Raw CSV rows, first being the header. */
  readonly rows: readonly (readonly string[])[];
  readonly plans: readonly ImportPlan[];
  readonly existing: readonly ExistingStudent[];
  /** Today in the tenant's timezone. */
  readonly today: string;
}

/**
 * Every column this understands, in the order the export writes them.
 *
 * Exported so the two share one definition. The export is deliberately
 * import-compatible — export, bulk-edit rooms in Excel, re-import is how a
 * start-of-term reshuffle will actually be done — and two hand-maintained lists
 * would drift the first time a column was added.
 *
 * Anything else in an uploaded file is ignored, so the office may keep its own
 * notes in the sheet.
 */
export const IMPORT_COLUMNS = [
  "roll_number",
  "full_name",
  "phone",
  "email",
  "block",
  "room_number",
  "joined_at",
  "status",
  "plan_name",
  "plan_start_date",
  "plan_end_date",
  "amount_paid_inr",
  "payment_reference",
  "subscription_status",
] as const;

const REQUIRED_COLUMNS = ["roll_number", "full_name"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE = /^\+?[0-9]{7,15}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "Roll Number", "ROLL-NUMBER" and "roll_number" are all the same column. */
function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Plan names are matched loosely, on purpose.
 *
 * The pilot tenant's only plan is `Monthly — Lunch & Dinner`, with an em-dash
 * that nobody typing in Excel will produce. Case, spacing and the three dash
 * characters are therefore all equivalent — and the preview shows the resolved
 * plan with its price, so a wrong match is visible before anything is written.
 */
function normalizePlanName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ");
}

/**
 * Rupees as typed, to integer paise.
 *
 * Parsed from the digit string rather than multiplying a float: `5200.55 * 100`
 * is 520054.99999999994, and rounding that wrong understates a payment by a
 * paisa permanently, on a row that can never be updated.
 *
 * Accepts what will actually be typed — `5,200`, `1,02,400`, `₹5200`, `Rs. 5200`.
 */
function parseRupees(raw: string): number | null {
  const cleaned = raw
    .replace(/[₹,\s]/g, "")
    .replace(/^rs\.?/i, "")
    .trim();
  if (cleaned === "") return null;

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;

  const rupees = Number(match[1]);
  const paise = Number((match[2] ?? "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(rupees)) return null;
  return rupees * 100 + paise;
}

export function previewStudentImport(request: ImportRequest): ImportPreview {
  const errors: ImportError[] = [];
  const rows: ImportRow[] = [];
  const empty = { create: 0, update: 0, subscriptions: 0, totalPaise: 0 };
  const fail = (message: string, column = "file"): ImportPreview => ({
    ok: false,
    rows: [],
    errors: [{ rowNumber: 1, column, message }],
    summary: empty,
  });

  if (request.rows.length === 0) return fail("The file is empty.");

  const header = request.rows[0]!.map(normalizeHeader);

  const seenHeaders = new Set<string>();
  for (const h of header) {
    if (!h) continue;
    if (seenHeaders.has(h)) return fail(`The column "${h}" appears twice. Remove one.`, h);
    seenHeaders.add(h);
  }

  for (const required of REQUIRED_COLUMNS) {
    if (!seenHeaders.has(required)) {
      return fail(`The file needs a "${required}" column.`, required);
    }
  }

  const dataRows = request.rows.slice(1);
  if (dataRows.every((r) => r.every((c) => c.trim() === ""))) {
    return fail("The file has a header but no rows.");
  }

  const columnAt = (row: readonly string[], name: string): string => {
    const index = header.indexOf(name);
    return index === -1 ? "" : (row[index] ?? "").trim();
  };

  const plansByName = new Map(request.plans.map((p) => [normalizePlanName(p.name), p]));
  const alreadyEnrolled = new Map(request.existing.map((e) => [e.rollNumber.toLowerCase(), e]));
  const seenRolls = new Map<string, number>();

  dataRows.forEach((raw, index) => {
    const rowNumber = index + 2; // The header is row 1 in the user's spreadsheet.

    // Trailing blank rows are what every spreadsheet is full of.
    if (raw.every((c) => c.trim() === "")) return;

    let rowFailed = false;
    const reject = (column: string, message: string): void => {
      if (rowFailed) return; // One error per row: the first thing to fix.
      rowFailed = true;
      errors.push({ rowNumber, column, message });
    };

    const get = (name: string): string => columnAt(raw, name);

    // --- identity ---
    const rollNumber = get("roll_number");
    if (!rollNumber) reject("roll_number", "Missing roll number.");
    else if (!isValidRollNumber(rollNumber)) {
      reject(
        "roll_number",
        `"${rollNumber}" cannot be used — letters, digits, dot, underscore and hyphen only.`,
      );
    } else {
      const key = rollNumber.toLowerCase();
      const earlier = seenRolls.get(key);
      if (earlier !== undefined) {
        reject("roll_number", `${rollNumber} also appears on row ${earlier}.`);
      } else {
        seenRolls.set(key, rowNumber);
      }
    }

    const fullName = get("full_name");
    if (!fullName) reject("full_name", "Missing name.");
    else if (fullName.length > 120) reject("full_name", "That name is too long.");

    const phone = get("phone");
    if (phone && !PHONE.test(phone)) reject("phone", `"${phone}" is not a valid phone number.`);

    const email = get("email");
    if (email && !EMAIL.test(email)) reject("email", `"${email}" is not a valid email address.`);

    const joinedAt = get("joined_at");
    if (joinedAt && !ISO_DATE.test(joinedAt)) {
      reject("joined_at", `Write the date as YYYY-MM-DD, not "${joinedAt}".`);
    }

    const statusRaw = get("status").toUpperCase();
    if (statusRaw && !(statusRaw in StudentStatus)) {
      reject(
        "status",
        `"${statusRaw}" is not a student status. Use ACTIVE, GRACE, BLOCKED or INACTIVE.`,
      );
    }

    // --- subscription ---
    const planNameRaw = get("plan_name");
    let subscription: ImportSubscription | undefined;
    const warnings: string[] = [];
    const existing = alreadyEnrolled.get(rollNumber.toLowerCase());

    if (planNameRaw) {
      const plan = plansByName.get(normalizePlanName(planNameRaw));
      if (!plan) {
        reject(
          "plan_name",
          `No plan called "${planNameRaw}". Create it in Plans first, or check the spelling.`,
        );
      } else {
        const startRaw = get("plan_start_date");
        if (!startRaw) {
          reject(
            "plan_start_date",
            "A plan needs a start date. Backdate it to when they began eating.",
          );
        } else if (!ISO_DATE.test(startRaw)) {
          reject("plan_start_date", `Write the date as YYYY-MM-DD, not "${startRaw}".`);
        } else {
          const startDate = toServiceDate(startRaw);
          const checked = validateSubscriptionStart({
            startDate,
            today: toServiceDate(request.today),
            durationDays: plan.durationDays,
          });
          if (!checked.ok) {
            reject("plan_start_date", checked.error.message);
          } else {
            const endRaw = get("plan_end_date");
            let endDate = addDays(startDate, plan.durationDays - 1);
            if (endRaw) {
              if (!ISO_DATE.test(endRaw)) {
                reject("plan_end_date", `Write the date as YYYY-MM-DD, not "${endRaw}".`);
              } else if (compareServiceDates(toServiceDate(endRaw), startDate) < 0) {
                reject("plan_end_date", "The end date is before the start date.");
              } else {
                endDate = toServiceDate(endRaw);
              }
            }

            const amountRaw = get("amount_paid_inr");
            let pricePaise = plan.pricePaise;
            if (amountRaw) {
              const parsed = parseRupees(amountRaw);
              if (parsed === null) {
                reject(
                  "amount_paid_inr",
                  `"${amountRaw}" is not an amount in rupees. Use digits, with at most two decimals.`,
                );
              } else {
                pricePaise = parsed;
              }
            }

            const statusColumn = get("subscription_status").toUpperCase();
            let subStatus: "ACTIVE" | "PENDING_PAYMENT" = amountRaw ? "ACTIVE" : "PENDING_PAYMENT";
            if (statusColumn) {
              if (statusColumn !== "ACTIVE" && statusColumn !== "PENDING_PAYMENT") {
                reject(
                  "subscription_status",
                  `"${statusColumn}" is not valid here. Use ACTIVE or PENDING_PAYMENT.`,
                );
              } else {
                subStatus = statusColumn;
              }
            }

            if (!rowFailed) {
              // Re-importing a corrected sheet is expected. An identical period
              // is a no-op; a DIFFERENT one is a decision the admin must make
              // on the student's page, with an audit entry — never a side
              // effect of re-uploading a spreadsheet.
              const live = existing?.activeSubscription;
              if (live && live.startDate === startDate && live.endDate === endDate) {
                warnings.push("Already has this exact plan — the subscription was left untouched.");
              } else if (live) {
                reject(
                  "plan_name",
                  `${rollNumber} already has an active plan (${live.startDate} to ${live.endDate}). End it on their page before importing a different one.`,
                );
              } else {
                subscription = {
                  planId: plan.id,
                  planName: plan.name,
                  startDate,
                  endDate,
                  pricePaise,
                  mealSlots: plan.mealSlots,
                  status: subStatus,
                  paymentReference: get("payment_reference") || undefined,
                };
              }
            }
          }
        }
      }
    }

    if (rowFailed) return;

    rows.push({
      rowNumber,
      action: existing ? "UPDATE" : "CREATE",
      studentId: existing?.studentId,
      student: {
        rollNumber,
        fullName,
        phone: phone || undefined,
        email: email || undefined,
        block: get("block") || undefined,
        roomNumber: get("room_number") || undefined,
        joinedAt: joinedAt || undefined,
        status: (statusRaw || "ACTIVE") as StudentStatus,
      },
      subscription,
      warnings,
    });
  });

  if (errors.length > 0) {
    return { ok: false, rows: [], errors, summary: empty };
  }

  return {
    ok: true,
    rows,
    errors: [],
    summary: {
      create: rows.filter((r) => r.action === "CREATE").length,
      update: rows.filter((r) => r.action === "UPDATE").length,
      subscriptions: rows.filter((r) => r.subscription).length,
      totalPaise: rows.reduce((n, r) => n + (r.subscription?.pricePaise ?? 0), 0),
    },
  };
}
