/**
 * SnapshotHeadcount — the number the kitchen cooks to (§8, §9).
 *
 * Runs from a cron before each meal. Two properties matter:
 *
 * 1. **Idempotent.** "Cron will fire twice one day." The write upserts on
 *    `(tenant_id, service_date, meal_slot)`, so a second run corrects rather
 *    than duplicating.
 *
 * 2. **Locked counts never move.** Once a snapshot is locked the mess has
 *    bought ingredients against that figure. Silently revising it afterwards
 *    would mean the recorded projection is not what anyone actually cooked to,
 *    and every variance report built on it would be wrong.
 *
 * A run that finds nothing still writes a zero. A missing row is
 * indistinguishable from "the job never ran"; an explicit zero says the answer
 * is genuinely none.
 */
import type { MealSlot } from "../domain/enums";
import { infrastructureError, type DomainError } from "../errors";
import { projectHeadcount, type HeadcountProjection } from "../policies/headcount.policy";
import type {
  HeadcountSnapshotRepository,
  MessCutRepository,
  SubscriptionRepository,
  TenantRepository,
} from "../ports/repositories";
import { ok, err, type Result } from "../result";
import type { ServiceDate } from "../time";

export interface SnapshotHeadcountDeps {
  readonly tenants: TenantRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly messCuts: MessCutRepository;
  readonly snapshots: HeadcountSnapshotRepository;
  readonly now: () => Date;
}

export interface SnapshotOptions {
  /** Freeze the count so later runs cannot change it. */
  readonly lock?: boolean;
  /** Restrict to specific slots; defaults to every slot the tenant serves. */
  readonly slots?: readonly MealSlot[];
}

export interface SnapshotResult {
  readonly serviceDate: ServiceDate;
  readonly written: readonly HeadcountProjection[];
  /** Slots left untouched because they were already locked. */
  readonly skipped: number;
}

export async function snapshotHeadcount(
  tenantId: string,
  serviceDate: ServiceDate,
  deps: SnapshotHeadcountDeps,
  options: SnapshotOptions = {},
): Promise<Result<SnapshotResult, DomainError>> {
  const settings = await deps.tenants.getSettings(tenantId);
  // Fail closed: without meal slots there is no way to know what to count, and
  // writing a partial or guessed set would be worse than writing nothing.
  if (!settings) return err(infrastructureError("tenant settings lookup"));

  const served = settings.mealSlots.map((s) => s.slot);
  const targets = options.slots ? served.filter((s) => options.slots!.includes(s)) : served;

  // Fetched once for the whole date rather than per slot: three round trips per
  // meal would triple the job's cost for no benefit.
  const [subscribers, cuts] = await Promise.all([
    deps.subscriptions.findActiveCovering(tenantId, serviceDate),
    deps.messCuts.findCoveringDate(tenantId, serviceDate),
  ]);

  const written: HeadcountProjection[] = [];
  let skipped = 0;

  for (const mealSlot of targets) {
    const existing = await deps.snapshots.find(tenantId, serviceDate, mealSlot);

    // The whole point of locking. Skip rather than fail, so one locked meal
    // does not stop the other from being counted.
    if (existing?.lockedAt) {
      skipped++;
      continue;
    }

    const projection = projectHeadcount({
      serviceDate,
      mealSlot,
      subscribers,
      messCuts: cuts,
    });

    await deps.snapshots.upsert({
      tenantId,
      serviceDate,
      mealSlot,
      projectedCount: projection.projectedCount,
      guestCount: projection.guestCount,
      extraPlateCount: projection.extraPlateCount,
      lockedAt: options.lock ? deps.now() : null,
    });

    written.push(projection);
  }

  return ok({ serviceDate, written, skipped });
}
