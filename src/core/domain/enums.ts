/**
 * Domain enums. These mirror the Postgres enum types created in migration 001,
 * and the two must stay in lockstep — a value added here without a migration
 * (or vice versa) is schema drift that the compiler cannot see.
 *
 * Declared as const objects rather than TypeScript `enum` so the values are
 * plain strings at runtime, comparable directly with what the database returns.
 */

export const MealSlot = {
  BREAKFAST: "BREAKFAST",
  LUNCH: "LUNCH",
  SNACKS: "SNACKS",
  DINNER: "DINNER",
} as const;
export type MealSlot = (typeof MealSlot)[keyof typeof MealSlot];

export const ALL_MEAL_SLOTS: readonly MealSlot[] = [
  MealSlot.BREAKFAST,
  MealSlot.LUNCH,
  MealSlot.SNACKS,
  MealSlot.DINNER,
];

export const UserRole = {
  STUDENT: "STUDENT",
  STAFF: "STAFF",
  ADMIN: "ADMIN",
  SUPER_ADMIN: "SUPER_ADMIN",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const StudentStatus = {
  ACTIVE: "ACTIVE",
  GRACE: "GRACE",
  BLOCKED: "BLOCKED",
  INACTIVE: "INACTIVE",
} as const;
export type StudentStatus = (typeof StudentStatus)[keyof typeof StudentStatus];

export const TenantStatus = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  CANCELLED: "CANCELLED",
} as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

/**
 * An absence request's lifecycle (rule 6 — one status, documented transitions).
 *
 * Only APPROVED and CREDITED remove a plate from the headcount. PENDING is a
 * request the admin has not yet looked at, and must never be treated as a
 * granted one: cooking for a student who is present is a small waste, but not
 * cooking for one who is here is the failure the product exists to prevent.
 */
export const MessCutStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  CREDITED: "CREDITED",
} as const;
export type MessCutStatus = (typeof MessCutStatus)[keyof typeof MessCutStatus];

export const ProfileStatus = {
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
} as const;
export type ProfileStatus = (typeof ProfileStatus)[keyof typeof ProfileStatus];

export const SubscriptionStatus = {
  PENDING_PAYMENT: "PENDING_PAYMENT",
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const AttendanceMethod = {
  QR: "QR",
  MANUAL: "MANUAL",
  RFID: "RFID",
} as const;
export type AttendanceMethod = (typeof AttendanceMethod)[keyof typeof AttendanceMethod];

export const PlanDuration = {
  MONTHLY: "MONTHLY",
  QUARTERLY: "QUARTERLY",
} as const;
export type PlanDuration = (typeof PlanDuration)[keyof typeof PlanDuration];

/**
 * Legal student status transitions (§2.6). Anything not listed is impossible by
 * construction, which is the entire point of using a state machine instead of
 * four independent booleans.
 *
 * GRACE and BLOCKED are driven by the Phase 2 dues engine; they are declared
 * here now so the guard is a single source of truth when that lands.
 */
const STUDENT_STATUS_TRANSITIONS: Readonly<Record<StudentStatus, readonly StudentStatus[]>> = {
  ACTIVE: ["GRACE", "BLOCKED", "INACTIVE"],
  GRACE: ["ACTIVE", "BLOCKED", "INACTIVE"],
  BLOCKED: ["ACTIVE", "INACTIVE"],
  // A student who has left can be re-admitted; everything else is terminal.
  INACTIVE: ["ACTIVE"],
};

export function canTransitionStudentStatus(from: StudentStatus, to: StudentStatus): boolean {
  if (from === to) return true;
  return STUDENT_STATUS_TRANSITIONS[from].includes(to);
}

const SUBSCRIPTION_STATUS_TRANSITIONS: Readonly<
  Record<SubscriptionStatus, readonly SubscriptionStatus[]>
> = {
  PENDING_PAYMENT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["EXPIRED", "CANCELLED"],
  EXPIRED: [],
  CANCELLED: [],
};

export function canTransitionSubscriptionStatus(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  if (from === to) return true;
  return SUBSCRIPTION_STATUS_TRANSITIONS[from].includes(to);
}
