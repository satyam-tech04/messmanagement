/**
 * RequestAbsence — a student marks themselves out of a meal or a period (§7.1).
 *
 * The policy in `absence.policy.ts` owns the rules. This use case owns the four
 * facts the rules need, and it is the only place that can get them wrong:
 *
 *   1. **Whose absence.** Always `ctx.studentId`, from the session. A student id
 *      in a request body is never read — that would let anyone cancel anyone's
 *      meals from a browser console.
 *   2. **What their plan covers.** Days outside the subscription were never paid
 *      for, so there is nothing to credit back; meals outside it were never
 *      bought. Both are refused rather than stored as a cut nobody owes for.
 *   3. **What the allowance has already spent**, including requests still under
 *      review — otherwise a student can submit five days five times while the
 *      admin is deciding, and win every race.
 *   4. **That a retry writes nothing new.** Enforced by
 *      `mess_cuts_one_live_request_idx`; a lost race is reported to the student
 *      as the success it is, not as a database error.
 *
 * Fails closed (rule 7): missing settings, a missing student or a missing plan
 * all produce no cut.
 */
import type { MealSlot } from "../domain/enums";
import type { MealSlotConfig, TenantContext } from "../domain/tenant-context";
import { domainError, forbidden, infrastructureError, type DomainError } from "../errors";
import { daysUsedInMonth, requestAbsence, type AbsenceKind } from "../policies/absence.policy";
import type {
  AbsenceRow,
  MessCutRepository,
  StudentRepository,
  TenantRepository,
} from "../ports/repositories";
import { err, isErr, ok, type Result } from "../result";
import { compareServiceDates, eachDateInclusive, mealWindowOn, type ServiceDate } from "../time";

export interface RequestAbsenceInput {
  readonly kind: AbsenceKind;
  readonly dateFrom: ServiceDate;
  readonly dateTo: ServiceDate;
  /** Ignored for AWAY — nobody is present for half a day. */
  readonly mealSlots: readonly MealSlot[];
}

export interface RequestAbsenceDeps {
  readonly tenants: TenantRepository;
  readonly students: StudentRepository;
  readonly messCuts: MessCutRepository;
  readonly now: () => Date;
}

/** Postgres unique-violation. The index is the idempotency guarantee. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export async function requestAbsenceForStudent(
  ctx: TenantContext,
  input: RequestAbsenceInput,
  deps: RequestAbsenceDeps,
): Promise<Result<AbsenceRow, DomainError>> {
  if (ctx.role !== "STUDENT" || !ctx.studentId) {
    return err(forbidden("Only a student can request their own absence."));
  }
  const studentId = ctx.studentId;
  const now = deps.now();

  const settings = await deps.tenants.getSettings(ctx.tenantId);
  if (!settings) return err(infrastructureError("tenant settings lookup"));

  const student = await deps.students.findForVerification(ctx.tenantId, studentId);
  if (!student) return err(domainError("NOT_FOUND", "Student record not found."));

  const plan = student.subscription;
  if (!plan) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "You have no meal plan, so there is nothing to cancel. Speak to the mess office.",
      ),
    );
  }

  // The plan must cover EVERY day of the range. A partially-covered request is
  // the dangerous case: half of it is legitimate, and quietly accepting the
  // whole thing would credit days nobody paid for.
  if (
    compareServiceDates(input.dateFrom, plan.startDate) < 0 ||
    compareServiceDates(input.dateTo, plan.endDate) > 0
  ) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Your plan runs ${plan.startDate} to ${plan.endDate}. You can only mark yourself out on days it covers.`,
        { planStart: plan.startDate, planEnd: plan.endDate },
      ),
    );
  }

  // A lunch-only subscriber cannot skip dinner: they were never charged for it,
  // and the policy only knows what the mess *serves*, not what this student bought.
  const paidFor = new Set(plan.includedMealSlots);
  const unpaid = input.mealSlots.filter((slot) => !paidFor.has(slot));
  if (input.kind === "SKIP" && unpaid.length > 0) {
    return err(
      domainError(
        "SLOT_NOT_SERVED",
        `Your plan does not include ${unpaid.map((s) => s.toLowerCase()).join(" or ")}.`,
        { slots: unpaid.join(",") },
      ),
    );
  }

  // Live requests overlapping this month, so the allowance is measured against
  // what the student has actually committed — including anything still PENDING.
  const live = await deps.messCuts.findLiveInMonth(ctx.tenantId, studentId, input.dateFrom);
  const daysAlreadyUsedThisMonth = daysUsedInMonth(live, input.dateFrom);

  const draft = requestAbsence({
    kind: input.kind,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    mealSlots: input.mealSlots,
    settings: {
      allowMealSkipping: settings.allowMealSkipping,
      allowPartialDaySkip: settings.allowPartialDaySkip,
      allowAwayRequests: settings.allowAwayRequests,
      awayRequiresApproval: settings.awayRequiresApproval,
      cutAdvanceHours: settings.cutAdvanceHours,
      cutMaxDaysPerMonth: settings.cutMaxDaysPerMonth,
      awayAdvanceHours: settings.awayAdvanceHours,
      awayMaxDays: settings.awayMaxDays,
      // An AWAY covers every meal the MESS serves; the plan check above has
      // already established the student pays for the ones being cut.
      mealWindows: settings.mealSlots.filter(
        (w) => input.kind === "AWAY" || paidFor.has(w.slot) || input.mealSlots.includes(w.slot),
      ),
    },
    now,
    timeZone: ctx.timezone,
    daysAlreadyUsedThisMonth,
  });
  if (isErr(draft)) return draft;

  const write = {
    tenantId: ctx.tenantId,
    studentId,
    subscriptionId: plan.id,
    dateFrom: draft.value.dateFrom,
    dateTo: draft.value.dateTo,
    mealSlots: draft.value.mealSlots,
    status: draft.value.status,
    // The instant the first affected meal opens, resolved in the tenant's
    // timezone — never the server's. This is what Phase 2's credit run compares
    // against to decide whether the cut arrived in time.
    effectiveFrom: openingOf(ctx.timezone, draft.value.dateFrom, draft.value.mealSlots, settings),
  };

  try {
    return ok(await deps.messCuts.create(write));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Lost the race with the student's own retry. The absence IS recorded —
    // by the other request — so this is a success. Re-read rather than
    // guessing, because the winner is the row their list will show.
    const existing = await deps.messCuts.findLiveInMonth(ctx.tenantId, studentId, input.dateFrom);
    const match = existing.find(
      (r) =>
        r.dateFrom === write.dateFrom &&
        r.dateTo === write.dateTo &&
        r.mealSlots.join(",") === write.mealSlots.join(","),
    );
    if (match) return ok(match);

    // The index rejected the insert but nothing matches it. Something other
    // than a retry is going on; say so rather than claiming a cut exists.
    return err(infrastructureError("absence request write"));
  }
}

/** When the first affected meal opens on `date`, in the tenant's timezone. */
function openingOf(
  timeZone: string,
  date: ServiceDate,
  slots: readonly MealSlot[],
  settings: { readonly mealSlots: readonly MealSlotConfig[] },
): Date {
  const windows = settings.mealSlots.filter((w) => slots.includes(w.slot));
  const openings = windows.map(
    (w) => mealWindowOn(timeZone, date, { start: w.start, end: w.end }).opensAt,
  );
  // The policy has already refused a request whose meals are not served, so
  // `windows` cannot be empty here.
  return openings.reduce((earliest, o) => (o < earliest ? o : earliest));
}

/** Calendar days a request covers — for the "you have N left" line on the form. */
export function daysCovered(dateFrom: ServiceDate, dateTo: ServiceDate): number {
  return eachDateInclusive(dateFrom, dateTo).length;
}
