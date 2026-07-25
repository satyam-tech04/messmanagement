/**
 * Repository ports (architecture doc §2.2).
 *
 * Core declares these interfaces; `src/infra/supabase` implements them. Core
 * never imports Supabase. The payoff is concrete: the entire verification and
 * billing logic is unit-testable against in-memory fakes in milliseconds, and
 * when RFID arrives for a larger mess, only the adapter behind
 * `AttendanceRepository` changes — the use case does not.
 *
 * Every method takes an explicit `tenantId`. There is no ambient tenant.
 */

import type { MealSlot, StudentStatus } from "../domain/enums";
import type { TenantSettings } from "../domain/tenant-context";
import type { ServiceDate } from "../time";
import type { MessCutSnapshot, SubscriberSnapshot } from "../policies/headcount.policy";

/** The facts the counter needs about a student, in one round trip. */
export interface StudentForVerification {
  readonly studentId: string;
  readonly tenantId: string;
  readonly rollNumber: string;
  readonly fullName: string;
  /** Staff must see this to close the "QR proves a phone, not a person" gap (§6.3). */
  readonly photoUrl: string | null;
  readonly status: StudentStatus;
  readonly subscription: {
    readonly id: string;
    readonly status: string;
    readonly startDate: ServiceDate;
    readonly endDate: ServiceDate;
    readonly includedMealSlots: readonly MealSlot[];
  } | null;
}

export interface AttendanceRecord {
  readonly id: string;
  readonly studentId: string;
  readonly serviceDate: ServiceDate;
  readonly mealSlot: MealSlot;
  readonly scannedAt: Date;
  readonly method: "QR" | "MANUAL" | "RFID";
}

/**
 * Outcome of an attendance write.
 *
 * `created: false` means the uniqueness constraint rejected a duplicate — the
 * student has already eaten this meal. This is a normal, expected outcome
 * (double-tap, retried offline queue entry, a friend trying a shared
 * screenshot), not an error, and it must be reported as such rather than
 * surfacing a raw database violation.
 */
export type RecordAttendanceOutcome =
  | { readonly created: true; readonly record: AttendanceRecord }
  | { readonly created: false; readonly existing: AttendanceRecord };

export interface RecordAttendanceInput {
  readonly tenantId: string;
  readonly studentId: string;
  readonly serviceDate: ServiceDate;
  readonly mealSlot: MealSlot;
  readonly scannedAt: Date;
  readonly method: "QR" | "MANUAL" | "RFID";
  readonly verifiedBy: string | null;
  readonly deviceId: string | null;
  readonly overrideReason: string | null;
}

export interface AttendanceRepository {
  /**
   * Records attendance idempotently.
   *
   * Implementations MUST rely on the `UNIQUE (tenant_id, student_id,
   * service_date, meal_slot)` constraint rather than a read-then-write check —
   * only the constraint holds when two counters scan the same student at the
   * same instant.
   */
  record(input: RecordAttendanceInput): Promise<RecordAttendanceOutcome>;

  countForMeal(tenantId: string, serviceDate: ServiceDate, mealSlot: MealSlot): Promise<number>;
}

export interface StudentRepository {
  findForVerification(tenantId: string, studentId: string): Promise<StudentForVerification | null>;

  /** Manual fallback lookup by roll number (§6.4). Case-insensitive. */
  findByRollNumber(tenantId: string, rollNumber: string): Promise<StudentForVerification | null>;
}

export interface TenantRepository {
  getSettings(tenantId: string): Promise<TenantSettings | null>;
  getTimezone(tenantId: string): Promise<string | null>;
  /** Server-side only. Never reaches a client (§5.3). */
  getQrSigningSecret(tenantId: string): Promise<string | null>;
}

export interface MessCutRepository {
  /** Approved cuts covering a date, used by verification and by the projection. */
  findCoveringDate(tenantId: string, serviceDate: ServiceDate): Promise<MessCutSnapshot[]>;

  findForStudentOnDate(
    tenantId: string,
    studentId: string,
    serviceDate: ServiceDate,
  ): Promise<MessCutSnapshot[]>;
}

export interface SubscriptionRepository {
  /** Every subscriber relevant to a date, for the headcount projection. */
  findActiveCovering(tenantId: string, serviceDate: ServiceDate): Promise<SubscriberSnapshot[]>;
}

export interface HeadcountSnapshotRow {
  readonly serviceDate: ServiceDate;
  readonly mealSlot: MealSlot;
  readonly projectedCount: number;
  readonly guestCount: number;
  readonly extraPlateCount: number;
  /** Non-null once the count is committed and must stop moving. */
  readonly lockedAt: Date | null;
}

export interface HeadcountSnapshotRepository {
  find(
    tenantId: string,
    serviceDate: ServiceDate,
    mealSlot: MealSlot,
  ): Promise<HeadcountSnapshotRow | null>;

  findForDate(tenantId: string, serviceDate: ServiceDate): Promise<HeadcountSnapshotRow[]>;

  /**
   * Upserts on `(tenant_id, service_date, meal_slot)`.
   *
   * Must use the unique constraint rather than read-then-write: the cron fires
   * twice some days, and a locked count that got duplicated would leave the
   * kitchen with two different numbers and no way to tell which was acted on.
   */
  upsert(input: {
    readonly tenantId: string;
    readonly serviceDate: ServiceDate;
    readonly mealSlot: MealSlot;
    readonly projectedCount: number;
    readonly guestCount: number;
    readonly extraPlateCount: number;
    readonly lockedAt: Date | null;
  }): Promise<void>;
}

/** Append-only audit trail for the actions that become disputes (§4.4). */
export interface AuditLogRepository {
  write(entry: {
    readonly tenantId: string;
    readonly actorProfileId: string | null;
    readonly action: string;
    readonly entityType: string;
    readonly entityId: string | null;
    readonly before?: unknown;
    readonly after?: unknown;
    readonly ip?: string | null;
    readonly userAgent?: string | null;
  }): Promise<void>;
}

export interface RateLimiter {
  /** Returns true when the request is permitted. */
  consume(bucketKey: string, windowSeconds: number, maxRequests: number): Promise<boolean>;
}
