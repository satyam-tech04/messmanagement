/**
 * IssueQrToken — mints the code a student shows at the counter (§6.1).
 *
 * The student's phone displays; the staff tablet scans. The token therefore
 * asserts *who is standing at the counter*, and is signed server-side with a
 * per-tenant secret the student can never read.
 *
 * Account status is checked **here as well as at verification**, using the same
 * `checkMealEligibility` policy. Denying at issuance is not merely an
 * optimisation: a blocked student who can still mint a code will queue, be
 * refused in front of everyone, and argue with staff who cannot explain it.
 * Refusing on their own phone, with a reason, moves that conversation to the
 * mess office where it belongs.
 *
 * Fails closed throughout (§2.7): missing settings or an unreadable signing
 * secret produce no token at all.
 */
import type { MealSlot } from "../domain/enums";
import type { TenantContext } from "../domain/tenant-context";
import { domainError, forbidden, infrastructureError, type DomainError } from "../errors";
import {
  activeSubscriptionsOf,
  checkMealEligibility,
  mealToShow,
} from "../policies/eligibility.policy";
import { serviceSlotsInOrder } from "../policies/menu.policy";
import { issueToken } from "../policies/qr.policy";
import type {
  AttendanceRepository,
  MessCutRepository,
  StudentRepository,
  TenantRepository,
} from "../ports/repositories";
import type { TokenSigner } from "../ports/token-signer";
import { err, isErr, ok, type Result } from "../result";
import { isWithinWindow, type ServiceDate } from "../time";

export interface IssueQrTokenDeps {
  readonly tenants: TenantRepository;
  readonly students: StudentRepository;
  readonly messCuts: MessCutRepository;
  readonly attendance: AttendanceRepository;
  readonly signer: TokenSigner;
  readonly now: () => Date;
  /** Injected so tests are deterministic; production passes a CSPRNG. */
  readonly nonce: () => string;
}

export interface IssuedQrToken {
  readonly token: string;
  readonly mealSlot: MealSlot;
  readonly serviceDate: ServiceDate;
  readonly expiresAt: Date;
  readonly refreshSeconds: number;
  /** True when the counter is open right now, false when this is the next meal. */
  readonly isOpenNow: boolean;
  /** When the meal opens — lets the screen count down rather than say nothing. */
  readonly opensAt: Date;
  readonly closesAt: Date;
  readonly studentName: string;
  readonly rollNumber: string;
}

export async function issueQrToken(
  ctx: TenantContext,
  deps: IssueQrTokenDeps,
): Promise<Result<IssuedQrToken, DomainError>> {
  // Only a student mints their own code, and only for themselves. `studentId`
  // comes from the session, never from the request — a staff member holding a
  // student id must not be able to mint that student's token.
  if (ctx.role !== "STUDENT" || !ctx.studentId) {
    return err(forbidden("Only a student can generate their own QR code."));
  }
  const studentId = ctx.studentId;

  const now = deps.now();

  const [settings, secret] = await Promise.all([
    deps.tenants.getSettings(ctx.tenantId),
    deps.tenants.getQrSigningSecret(ctx.tenantId),
  ]);

  if (!settings) return err(infrastructureError("tenant settings lookup"));
  if (!secret) return err(infrastructureError("QR signing secret lookup"));

  const student = await deps.students.findForVerification(ctx.tenantId, studentId);
  if (!student) return err(domainError("NOT_FOUND", "Student record not found."));

  // Which meal is this code for? The soonest one this student's plan includes:
  // the open meal if they bought it, otherwise their next. Showing a lunch code
  // at 16:30 would be useless, and refusing a lunch-and-dinner subscriber at
  // breakfast told them they had "no active plan" for a plan they had just paid
  // for. The counter still checks the slot being served, so a code for a later
  // meal cannot be used early.
  const candidates = serviceSlotsInOrder({
    timeZone: ctx.timezone,
    now,
    slots: settings.mealSlots,
  });
  const target = mealToShow(candidates, activeSubscriptionsOf(student));
  if (!target) {
    return err(domainError("SLOT_NOT_SERVED", "This mess has no meal times configured."));
  }

  const cuts = await deps.messCuts.findForStudentOnDate(
    ctx.tenantId,
    studentId,
    target.serviceDate,
  );

  // The identical check the counter will run. See eligibility.policy.ts.
  const eligible = checkMealEligibility({
    student,
    expectedTenantId: ctx.tenantId,
    mealSlot: target.slot,
    serviceDate: target.serviceDate,
    cuts,
  });
  if (isErr(eligible)) return eligible;

  // Already eaten? Stop showing a live code. Otherwise the phone keeps
  // displaying one after the meal, the student holds it up again, and the
  // counter refuses them publicly for doing nothing wrong. The screen renders
  // this as a confirmation, not a failure.
  const served = await deps.attendance.findForStudentMeal(
    ctx.tenantId,
    studentId,
    target.serviceDate,
    target.slot,
  );
  if (served) {
    return err(
      domainError("ALREADY_SERVED", `${target.slot.toLowerCase()} already served today.`, {
        slot: target.slot,
        servedAt: served.scannedAt.toISOString(),
        method: served.method,
      }),
    );
  }

  const issued = issueToken({
    tenantId: ctx.tenantId,
    studentId,
    mealSlot: target.slot,
    // The meal's own date, from resolveServiceState — which attributes a
    // midnight-crossing dinner to the day it started, and tomorrow's lunch to
    // tomorrow.
    serviceDate: target.serviceDate,
    settings,
    now,
    timezone: ctx.timezone,
    secret,
    nonce: deps.nonce(),
    signer: deps.signer,
  });
  if (isErr(issued)) return issued;

  return ok({
    token: issued.value.token,
    mealSlot: target.slot,
    serviceDate: target.serviceDate,
    expiresAt: issued.value.expiresAt,
    refreshSeconds: issued.value.refreshSeconds,
    isOpenNow: isWithinWindow(now, target),
    opensAt: target.opensAt,
    closesAt: target.closesAt,
    studentName: student.fullName,
    rollNumber: student.rollNumber,
  });
}
