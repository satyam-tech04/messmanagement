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
  AttendanceRecord,
  AttendanceRepository,
  AuditLogRepository,
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
