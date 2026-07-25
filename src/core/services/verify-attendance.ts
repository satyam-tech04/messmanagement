/**
 * VerifyAttendance — the counter's critical path (architecture doc §6.3).
 *
 * Runs the full sequence for a scanned QR code:
 *
 *   verify HMAC → check TTL → check tenant → check meal window (tenant TZ)
 *   → check subscription ACTIVE → check student not BLOCKED
 *   → check no approved mess-cut → INSERT attendance (unique)
 *
 * The first four are pure and live in `qr.policy`; this use case orchestrates
 * the rest. Two properties matter more than anything else here:
 *
 * 1. **Fails closed** (§2.7). Any indeterminate state — settings missing, no
 *    signing secret, an unreadable subscription — denies the scan. Staff then
 *    use the audited manual fallback. A wrongly-denied meal costs 20 seconds;
 *    a systematically bypassable QR costs the product.
 *
 * 2. **Idempotent** (§2.5). The duplicate check is the database's uniqueness
 *    constraint, not a read-then-write. A double-tap, a retried offline queue
 *    entry, and two counters scanning at once all converge on exactly one
 *    attendance row.
 *
 * Performance target: p95 < 500 ms. At 200 students in 20 minutes there are
 * about six seconds per student including walking, so this path does the
 * minimum number of round trips it can.
 */

import type { MealSlot } from "../domain/enums";
import type { TenantContext } from "../domain/tenant-context";
import { requireRole } from "../domain/tenant-context";
import { domainError, infrastructureError, type DomainError } from "../errors";
import { verifyToken } from "../policies/qr.policy";
import { checkMealEligibility } from "../policies/eligibility.policy";
import type {
  AttendanceRepository,
  AuditLogRepository,
  MessCutRepository,
  StudentForVerification,
  StudentRepository,
  TenantRepository,
} from "../ports/repositories";
import type { TokenSigner } from "../ports/token-signer";
import { err, isErr, ok, type Result } from "../result";
import { serviceDateOf, type ServiceDate } from "../time";

export interface VerifyAttendanceDeps {
  readonly tenants: TenantRepository;
  readonly students: StudentRepository;
  readonly attendance: AttendanceRepository;
  readonly messCuts: MessCutRepository;
  readonly audit: AuditLogRepository;
  readonly signer: TokenSigner;
  readonly now: () => Date;
}

export interface VerifyQrInput {
  readonly token: string;
  readonly deviceId: string | null;
}

export interface ManualVerifyInput {
  readonly rollNumber: string;
  readonly mealSlot: MealSlot;
  /** Mandatory. Manual entries are exactly the rows that become disputes. */
  readonly reason: string;
  readonly deviceId: string | null;
}

/** What the scanner shows on success: a green tick, the name, and the photo. */
export interface VerifiedAttendance {
  readonly attendanceId: string;
  readonly studentId: string;
  readonly rollNumber: string;
  readonly fullName: string;
  readonly photoUrl: string | null;
  readonly mealSlot: MealSlot;
  readonly serviceDate: ServiceDate;
  readonly servedAt: Date;
  /**
   * Set when the meal was recorded but its audit entry could not be written.
   *
   * Only reachable on the manual path. The attendance row is already committed
   * and cannot be cleanly rolled back, and withholding food over a logging
   * failure would be the wrong trade — but an unexplained manual entry is
   * exactly the row an admin questions weeks later, so staff are told now.
   */
  readonly auditFailed?: boolean;
}

export async function verifyQrAttendance(
  ctx: TenantContext,
  input: VerifyQrInput,
  deps: VerifyAttendanceDeps,
): Promise<Result<VerifiedAttendance, DomainError>> {
  // Only staff and admins operate a counter. A student holding a valid token
  // must not be able to mark their own attendance by calling this directly.
  const authorized = requireRole(ctx, "STAFF", "ADMIN", "SUPER_ADMIN");
  if (isErr(authorized)) return authorized;

  const now = deps.now();

  const [settings, secret] = await Promise.all([
    deps.tenants.getSettings(ctx.tenantId),
    deps.tenants.getQrSigningSecret(ctx.tenantId),
  ]);

  // Fail closed: without settings or a secret we cannot validate anything.
  if (!settings) return err(infrastructureError("tenant settings lookup"));
  if (!secret) return err(infrastructureError("QR signing secret lookup"));

  const verified = verifyToken({
    token: input.token,
    expectedTenantId: ctx.tenantId,
    settings,
    timezone: ctx.timezone,
    secret,
    now,
    signer: deps.signer,
  });
  if (isErr(verified)) return verified;

  const { studentId, mealSlot, serviceDate } = verified.value;

  const eligibility = await checkAccountEligibility(
    ctx,
    { studentId, mealSlot, serviceDate },
    deps,
  );
  if (isErr(eligibility)) return eligibility;

  return commitAttendance(ctx, {
    student: eligibility.value,
    mealSlot,
    serviceDate,
    now,
    method: "QR",
    deviceId: input.deviceId,
    overrideReason: null,
    deps,
  });
}

/**
 * Audited manual fallback (§6.4).
 *
 * "Mess counters have bad Wi-Fi during exactly the 20 minutes that matter."
 * This runs the **same** validation path as a QR scan — it is a different
 * identification method, not a way around the rules. The reason is mandatory,
 * the entry is audit-logged, and it surfaces on the admin dashboard so that a
 * staff member fabricating attendance is visible rather than invisible.
 */
export async function verifyManualAttendance(
  ctx: TenantContext,
  input: ManualVerifyInput,
  deps: VerifyAttendanceDeps,
): Promise<Result<VerifiedAttendance, DomainError>> {
  const authorized = requireRole(ctx, "STAFF", "ADMIN", "SUPER_ADMIN");
  if (isErr(authorized)) return authorized;

  if (input.reason.trim().length === 0) {
    return err(domainError("VALIDATION_FAILED", "A reason is required for a manual entry."));
  }

  const now = deps.now();
  const settings = await deps.tenants.getSettings(ctx.tenantId);
  if (!settings) return err(infrastructureError("tenant settings lookup"));

  const slotConfig = settings.mealSlots.find((s) => s.slot === input.mealSlot);
  if (!slotConfig) {
    return err(domainError("SLOT_NOT_SERVED", `This mess does not serve ${input.mealSlot}.`));
  }

  const student = await deps.students.findByRollNumber(ctx.tenantId, input.rollNumber.trim());
  if (!student) {
    return err(domainError("NOT_FOUND", "No student with that roll number."));
  }

  // The service date is derived from the tenant's clock, not supplied by the
  // caller — otherwise a manual entry could backdate attendance.
  const serviceDate = serviceDateOf(ctx.timezone, now);

  const eligibility = await checkAccountEligibility(
    ctx,
    { studentId: student.studentId, mealSlot: input.mealSlot, serviceDate },
    deps,
    student,
  );
  if (isErr(eligibility)) return eligibility;

  return commitAttendance(ctx, {
    student: eligibility.value,
    mealSlot: input.mealSlot,
    serviceDate,
    now,
    method: "MANUAL",
    deviceId: input.deviceId,
    overrideReason: input.reason.trim(),
    deps,
  });
}

// ---------------------------------------------------------------------------
// Shared checks — identical for QR and manual, deliberately (§6.4)
// ---------------------------------------------------------------------------

async function checkAccountEligibility(
  ctx: TenantContext,
  target: { studentId: string; mealSlot: MealSlot; serviceDate: ServiceDate },
  deps: VerifyAttendanceDeps,
  preloaded?: StudentForVerification,
): Promise<Result<StudentForVerification, DomainError>> {
  const student =
    preloaded ?? (await deps.students.findForVerification(ctx.tenantId, target.studentId));

  if (!student) return err(domainError("NOT_FOUND", "Student record not found."));

  const cuts = await deps.messCuts.findForStudentOnDate(
    ctx.tenantId,
    student.studentId,
    target.serviceDate,
  );

  // The same policy the student's phone ran at issuance. One implementation,
  // two callers — see eligibility.policy.ts for why that matters.
  return checkMealEligibility({
    student,
    expectedTenantId: ctx.tenantId,
    mealSlot: target.mealSlot,
    serviceDate: target.serviceDate,
    cuts,
  });
}

async function commitAttendance(
  ctx: TenantContext,
  args: {
    student: StudentForVerification;
    mealSlot: MealSlot;
    serviceDate: ServiceDate;
    now: Date;
    method: "QR" | "MANUAL";
    deviceId: string | null;
    overrideReason: string | null;
    deps: VerifyAttendanceDeps;
  },
): Promise<Result<VerifiedAttendance, DomainError>> {
  const { student, deps } = args;

  let outcome;
  try {
    outcome = await deps.attendance.record({
      tenantId: ctx.tenantId,
      studentId: student.studentId,
      serviceDate: args.serviceDate,
      mealSlot: args.mealSlot,
      scannedAt: args.now,
      method: args.method,
      verifiedBy: ctx.actorProfileId,
      deviceId: args.deviceId,
      overrideReason: args.overrideReason,
    });
  } catch {
    // Fail closed. The scanner will queue and retry; idempotency makes that safe.
    return err(infrastructureError("attendance write"));
  }

  if (!outcome.created) {
    return err(
      domainError("ALREADY_SERVED", `${student.fullName} has already been served this meal.`, {
        rollNumber: student.rollNumber,
        servedAt: outcome.existing.scannedAt.toISOString(),
        method: outcome.existing.method,
      }),
    );
  }

  // Manual entries are audit-logged; QR scans are not, because 600 audit rows a
  // day of ordinary scans would bury the overrides that actually need review.
  let auditFailed = false;
  if (args.method === "MANUAL") {
    try {
      await deps.audit.write({
        tenantId: ctx.tenantId,
        actorProfileId: ctx.actorProfileId,
        action: "ATTENDANCE_MANUAL_OVERRIDE",
        entityType: "attendance",
        entityId: outcome.record.id,
        after: {
          studentId: student.studentId,
          rollNumber: student.rollNumber,
          serviceDate: args.serviceDate,
          mealSlot: args.mealSlot,
          reason: args.overrideReason,
        },
      });
    } catch {
      // The attendance row is already committed. Letting this propagate would
      // surface as a 500 at the counter while the student *is* recorded as
      // served — staff would then reasonably turn them away. Report it instead.
      auditFailed = true;
    }
  }

  return ok({
    attendanceId: outcome.record.id,
    studentId: student.studentId,
    rollNumber: student.rollNumber,
    fullName: student.fullName,
    photoUrl: student.photoUrl,
    mealSlot: args.mealSlot,
    serviceDate: args.serviceDate,
    servedAt: outcome.record.scannedAt,
    ...(auditFailed ? { auditFailed: true } : {}),
  });
}
