/**
 * In-memory repository fakes.
 *
 * These exist because the domain layer is persistence-free (§2.2): the entire
 * verification path can be exercised with no database, no network and no
 * container, in milliseconds. That is what makes it affordable to test the
 * awkward cases — duplicate scans, blocked students, cross-tenant tokens —
 * that would otherwise never get covered.
 *
 * The attendance fake reproduces the real uniqueness constraint faithfully,
 * because that constraint IS the anti-replay guarantee. A fake that let
 * duplicates through would make the tests lie about the property that matters
 * most.
 */

import type { MealSlot } from "@/core/domain/enums";
import type { TenantSettings } from "@/core/domain/tenant-context";
import type { MessCutSnapshot, SubscriberSnapshot } from "@/core/policies/headcount.policy";
import type {
  AbsenceRow,
  CreateAbsenceInput,
  AttendanceRecord,
  AttendanceRepository,
  AuditLogRepository,
  HeadcountSnapshotRepository,
  HeadcountSnapshotRow,
  MessCutRepository,
  RateLimiter,
  RecordAttendanceInput,
  RecordAttendanceOutcome,
  StudentForVerification,
  StudentRepository,
  SubscriptionRepository,
  TenantRepository,
} from "@/core/ports/repositories";
import type { TokenSigner } from "@/core/ports/token-signer";
import type { ServiceDate } from "@/core/time";
import { toWallClockTime } from "@/core/time";

export class FakeAttendanceRepository implements AttendanceRepository {
  readonly rows: AttendanceRecord[] = [];
  /** Set to make the next write throw, simulating a counter Wi-Fi drop. */
  failNextWrite = false;
  private sequence = 0;

  private key(t: string, s: string, d: string, m: string): string {
    return `${t}|${s}|${d}|${m}`;
  }

  private readonly index = new Map<string, AttendanceRecord>();

  async record(input: RecordAttendanceInput): Promise<RecordAttendanceOutcome> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("simulated database failure");
    }

    const key = this.key(input.tenantId, input.studentId, input.serviceDate, input.mealSlot);

    // This mirrors INSERT ... ON CONFLICT DO NOTHING RETURNING.
    const existing = this.index.get(key);
    if (existing) return { created: false, existing };

    const record: AttendanceRecord = {
      id: `attendance-${++this.sequence}`,
      studentId: input.studentId,
      serviceDate: input.serviceDate,
      mealSlot: input.mealSlot,
      scannedAt: input.scannedAt,
      method: input.method,
    };
    this.index.set(key, record);
    this.rows.push(record);
    return { created: true, record };
  }

  async findForStudentMeal(
    tenantId: string,
    studentId: string,
    serviceDate: ServiceDate,
    mealSlot: MealSlot,
  ): Promise<AttendanceRecord | null> {
    return (
      this.rows.find(
        (r) =>
          r.studentId === studentId && r.serviceDate === serviceDate && r.mealSlot === mealSlot,
      ) ?? null
    );
  }

  async countForMeal(
    tenantId: string,
    serviceDate: ServiceDate,
    mealSlot: MealSlot,
  ): Promise<number> {
    return this.rows.filter((r) => r.serviceDate === serviceDate && r.mealSlot === mealSlot).length;
  }
}

export class FakeStudentRepository implements StudentRepository {
  constructor(private readonly students: StudentForVerification[] = []) {}

  add(student: StudentForVerification): void {
    this.students.push(student);
  }

  async findForVerification(
    tenantId: string,
    studentId: string,
  ): Promise<StudentForVerification | null> {
    return this.students.find((s) => s.tenantId === tenantId && s.studentId === studentId) ?? null;
  }

  async findByRollNumber(
    tenantId: string,
    rollNumber: string,
  ): Promise<StudentForVerification | null> {
    return (
      this.students.find(
        (s) => s.tenantId === tenantId && s.rollNumber.toLowerCase() === rollNumber.toLowerCase(),
      ) ?? null
    );
  }
}

export class FakeTenantRepository implements TenantRepository {
  constructor(
    private readonly settings: Map<string, TenantSettings> = new Map(),
    private readonly timezones: Map<string, string> = new Map(),
    private readonly secrets: Map<string, string> = new Map(),
  ) {}

  set(tenantId: string, settings: TenantSettings, timezone: string, secret: string): void {
    this.settings.set(tenantId, settings);
    this.timezones.set(tenantId, timezone);
    this.secrets.set(tenantId, secret);
  }

  async getSettings(tenantId: string): Promise<TenantSettings | null> {
    return this.settings.get(tenantId) ?? null;
  }

  async getTimezone(tenantId: string): Promise<string | null> {
    return this.timezones.get(tenantId) ?? null;
  }

  async getQrSigningSecret(tenantId: string): Promise<string | null> {
    return this.secrets.get(tenantId) ?? null;
  }
}

export class FakeMessCutRepository implements MessCutRepository {
  constructor(private readonly cuts: MessCutSnapshot[] = []) {}

  add(cut: MessCutSnapshot): void {
    this.cuts.push(cut);
  }

  async findCoveringDate(_tenantId: string, serviceDate: ServiceDate): Promise<MessCutSnapshot[]> {
    return this.cuts.filter((c) => c.dateFrom <= serviceDate && c.dateTo >= serviceDate);
  }

  async findForStudentOnDate(
    _tenantId: string,
    studentId: string,
    serviceDate: ServiceDate,
  ): Promise<MessCutSnapshot[]> {
    return this.cuts.filter(
      (c) => c.studentId === studentId && c.dateFrom <= serviceDate && c.dateTo >= serviceDate,
    );
  }

  /** Rows written through `create`, in insertion order. */
  readonly rows: AbsenceRow[] = [];

  /** Set to simulate the unique index rejecting a duplicate submit. */
  failNextCreateAsDuplicate = false;

  async findLiveInMonth(
    _tenantId: string,
    studentId: string,
    reference: ServiceDate,
  ): Promise<AbsenceRow[]> {
    const month = reference.slice(0, 7);
    return this.rows.filter(
      (r) =>
        r.studentId === studentId &&
        (r.status === "PENDING" || r.status === "APPROVED" || r.status === "CREDITED") &&
        // Overlaps the month, the same test the SQL runs.
        r.dateFrom.slice(0, 7) <= month &&
        r.dateTo.slice(0, 7) >= month,
    );
  }

  async create(input: CreateAbsenceInput): Promise<AbsenceRow> {
    const key = (r: { dateFrom: string; dateTo: string; mealSlots: readonly MealSlot[] }) =>
      `${r.dateFrom}|${r.dateTo}|${[...r.mealSlots].join(",")}`;

    // Mirrors `mess_cuts_one_live_request_idx`: a retried submit finds the row
    // that already exists rather than adding a second one.
    const existing = this.rows.find(
      (r) =>
        r.studentId === input.studentId &&
        key(r) === key(input) &&
        (r.status === "PENDING" || r.status === "APPROVED" || r.status === "CREDITED"),
    );
    if (existing) return existing;

    const row: AbsenceRow = {
      id: `cut-${this.rows.length + 1}`,
      studentId: input.studentId,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      mealSlots: input.mealSlots,
      status: input.status,
      requestedAt: new Date("2026-08-15T00:00:00Z"),
      rejectionReason: null,
    };
    this.rows.push(row);

    // A lost race, faithfully: the other request's row IS there, and ours is
    // the insert the unique index rejected. Storing then throwing is what makes
    // the recovery path — re-read, return the winner — actually get exercised.
    if (this.failNextCreateAsDuplicate) {
      this.failNextCreateAsDuplicate = false;
      throw Object.assign(new Error("duplicate key value"), { code: "23505" });
    }

    return row;
  }

  async cancel(_tenantId: string, studentId: string, id: string): Promise<AbsenceRow | null> {
    const index = this.rows.findIndex((r) => r.id === id && r.studentId === studentId);
    if (index < 0) return null;
    const cancelled: AbsenceRow = { ...this.rows[index]!, status: "CANCELLED" };
    this.rows[index] = cancelled;
    return cancelled;
  }

  async findForStudent(_tenantId: string, studentId: string, limit: number): Promise<AbsenceRow[]> {
    return this.rows
      .filter((r) => r.studentId === studentId)
      .sort((a, b) => b.dateFrom.localeCompare(a.dateFrom))
      .slice(0, limit);
  }
}

export class FakeSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly subscribers: SubscriberSnapshot[] = []) {}

  async findActiveCovering(
    _tenantId: string,
    serviceDate: ServiceDate,
  ): Promise<SubscriberSnapshot[]> {
    return this.subscribers.filter((s) => s.startDate <= serviceDate && s.endDate >= serviceDate);
  }
}

/**
 * Mirrors the real `(tenant_id, service_date, meal_slot)` unique constraint, so
 * a re-run overwrites rather than duplicating — the property the cron depends
 * on.
 */
export class FakeHeadcountSnapshotRepository implements HeadcountSnapshotRepository {
  readonly rows: HeadcountSnapshotRow[] = [];

  /** Synchronous accessor for assertions; the port method stays async. */
  rowFor(serviceDate: ServiceDate, mealSlot: MealSlot): HeadcountSnapshotRow | null {
    return this.rows.find((r) => r.serviceDate === serviceDate && r.mealSlot === mealSlot) ?? null;
  }

  async find(
    _tenantId: string,
    serviceDate: ServiceDate,
    mealSlot: MealSlot,
  ): Promise<HeadcountSnapshotRow | null> {
    return this.rows.find((r) => r.serviceDate === serviceDate && r.mealSlot === mealSlot) ?? null;
  }

  async findForDate(_tenantId: string, serviceDate: ServiceDate): Promise<HeadcountSnapshotRow[]> {
    return this.rows.filter((r) => r.serviceDate === serviceDate);
  }

  async upsert(input: {
    tenantId: string;
    serviceDate: ServiceDate;
    mealSlot: MealSlot;
    projectedCount: number;
    guestCount: number;
    extraPlateCount: number;
    lockedAt: Date | null;
  }): Promise<void> {
    const row: HeadcountSnapshotRow = {
      serviceDate: input.serviceDate,
      mealSlot: input.mealSlot,
      projectedCount: input.projectedCount,
      guestCount: input.guestCount,
      extraPlateCount: input.extraPlateCount,
      lockedAt: input.lockedAt,
    };
    const index = this.rows.findIndex(
      (r) => r.serviceDate === input.serviceDate && r.mealSlot === input.mealSlot,
    );
    if (index >= 0) this.rows[index] = row;
    else this.rows.push(row);
  }
}

export class FakeAuditLogRepository implements AuditLogRepository {
  readonly entries: Array<Record<string, unknown>> = [];
  /** Simulates the audit write failing after attendance was already committed. */
  failWrites = false;

  async write(entry: Record<string, unknown>): Promise<void> {
    if (this.failWrites) throw new Error("simulated audit_log write failure");
    this.entries.push(entry);
  }
}

export class FakeRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, number>();
  allowAll = true;

  async consume(bucketKey: string, _windowSeconds: number, maxRequests: number) {
    if (this.allowAll) return true;
    const next = (this.counts.get(bucketKey) ?? 0) + 1;
    this.counts.set(bucketKey, next);
    return next <= maxRequests;
  }
}

/**
 * Deterministic signer. Not cryptography — it exists so policy tests stay pure
 * and fast. The real HMAC adapter is covered by its own infra test.
 */
export const fakeSigner: TokenSigner = {
  sign(payload, secret) {
    let h = 5381;
    const input = `${payload}::${secret}`;
    for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    return `fake-${(h >>> 0).toString(36)}`;
  },
  verify(payload, signature, secret) {
    return signature === this.sign(payload, secret);
  },
};

/**
 * Tenant settings for a test, with everything but the interesting bits filled
 * in.
 *
 * Five test files used to build this literal by hand, so adding one field to
 * `TenantSettings` broke all five at once and each had to be patched
 * identically. Defaults live here; a test overrides only what it is actually
 * about.
 */
export function tenantSettings(over: Partial<TenantSettings> = {}): TenantSettings {
  return {
    tenantId: "11111111-1111-1111-1111-111111111111",
    mealSlots: [
      { slot: "LUNCH", start: toWallClockTime("12:00"), end: toWallClockTime("14:30") },
      { slot: "DINNER", start: toWallClockTime("19:30"), end: toWallClockTime("22:00") },
    ],
    cutAdvanceHours: 12,
    cutMaxDaysPerMonth: 5,
    gracePeriodDays: 3,
    blockOnOverdue: true,
    allowExtras: false,
    guestTokenPricePaise: 0,
    extraPlatePricePaise: 0,
    qrTokenTtlSeconds: 30,
    qrRefreshSeconds: 15,
    currency: "INR",
    // Absences default off, exactly as a real mess starts out.
    allowMealSkipping: false,
    allowPartialDaySkip: true,
    allowAwayRequests: false,
    awayRequiresApproval: true,
    awayAdvanceHours: 24,
    awayMaxDays: 30,
    ...over,
  };
}
