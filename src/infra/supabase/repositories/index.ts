/**
 * Composition root for the persistence layer.
 *
 * This is the single place where the abstract ports declared in
 * `src/core/ports` are bound to concrete Supabase implementations. Use cases
 * receive the resulting object and remain unaware that Postgres exists — which
 * is what lets them be tested against in-memory fakes in milliseconds.
 *
 * Note which client each repository gets. That choice IS the security model:
 *
 * - Most repositories take the **session client**, so every query runs under
 *   RLS as the calling user. Even if a `tenant_id` filter is forgotten in
 *   application code, the database still refuses the cross-tenant row.
 * - Only three take the **service-role client**, each for a specific reason
 *   that cannot be satisfied otherwise: the QR signing secret (RLS-enabled with
 *   no policies), the audit log (no insert policy, so entries cannot be forged
 *   or suppressed by the actor they describe), and the rate limiter (a client
 *   able to reset its own bucket is not a rate limiter).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AttendanceRepository,
  AuditLogRepository,
  HeadcountSnapshotRepository,
  MessCutRepository,
  RateLimiter,
  StudentRepository,
  SubscriptionRepository,
  TenantRepository,
} from "@/core/ports/repositories";
import type { Database } from "../database.types";
import { SupabaseAttendanceRepository } from "./attendance.repository";
import { SupabaseHeadcountSnapshotRepository } from "./headcount-snapshot.repository";
import { SupabaseAuditLogRepository } from "./audit-log.repository";
import { SupabaseMessCutRepository } from "./mess-cut.repository";
import { SupabaseRateLimiter } from "./rate-limiter";
import { SupabaseStudentRepository } from "./student.repository";
import { SupabaseSubscriptionRepository } from "./subscription.repository";
import { SupabaseTenantRepository } from "./tenant.repository";

export interface Repositories {
  readonly tenants: TenantRepository;
  readonly students: StudentRepository;
  readonly attendance: AttendanceRepository;
  readonly messCuts: MessCutRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly headcountSnapshots: HeadcountSnapshotRepository;
  readonly audit: AuditLogRepository;
  readonly rateLimiter: RateLimiter;
}

export function createRepositories(
  /** The caller's session client. Queries run under RLS as that user. */
  db: SupabaseClient<Database>,
  /** Service-role client. Bypasses RLS; used only where noted above. */
  admin: SupabaseClient<Database>,
): Repositories {
  return {
    tenants: new SupabaseTenantRepository(db, admin),
    students: new SupabaseStudentRepository(db),
    attendance: new SupabaseAttendanceRepository(db),
    messCuts: new SupabaseMessCutRepository(db),
    subscriptions: new SupabaseSubscriptionRepository(db),
    headcountSnapshots: new SupabaseHeadcountSnapshotRepository(db),
    audit: new SupabaseAuditLogRepository(admin),
    rateLimiter: new SupabaseRateLimiter(admin),
  };
}

export { rateLimitBuckets } from "./rate-limiter";
export {
  SupabaseAttendanceRepository,
  SupabaseAuditLogRepository,
  SupabaseHeadcountSnapshotRepository,
  SupabaseMessCutRepository,
  SupabaseRateLimiter,
  SupabaseStudentRepository,
  SupabaseSubscriptionRepository,
  SupabaseTenantRepository,
};
