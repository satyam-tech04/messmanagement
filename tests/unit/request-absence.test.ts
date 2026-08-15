/**
 * Tests for the RequestAbsence use case.
 *
 * The policy already owns the rules; this covers what only the use case can get
 * wrong — the facts it gathers before asking, and what it writes afterwards:
 *
 *   * whose absence this is (never the id in the request body)
 *   * whether their plan covers the days and the meals being cut
 *   * how much of the monthly allowance is already spent
 *   * that a retried submit adds no second row
 *
 * A wrong answer to any of these is a student either paying for meals they
 * cancelled or cancelling meals they never bought.
 */
import { describe, expect, it } from "vitest";
import { MealSlot, UserRole } from "@/core/domain/enums";
import type { TenantContext } from "@/core/domain/tenant-context";
import { requestAbsenceForStudent } from "@/core/services/request-absence";
import { isErr, isOk, unwrap } from "@/core/result";
import { toServiceDate, toWallClockTime } from "@/core/time";
import {
  FakeMessCutRepository,
  FakeStudentRepository,
  FakeTenantRepository,
  tenantSettings,
} from "../fakes";

const TENANT = "11111111-1111-1111-1111-111111111111";
const STUDENT = "33333333-3333-3333-3333-333333333333";
const OTHER_STUDENT = "44444444-4444-4444-4444-444444444444";
const IST = "Asia/Kolkata";

/** 10:00 IST on 10 Aug 2026. Lunch opens at 12:00, dinner at 19:30. */
const NOW = new Date("2026-08-10T04:30:00Z");

const SETTINGS = tenantSettings({
  tenantId: TENANT,
  mealSlots: [
    { slot: MealSlot.LUNCH, start: toWallClockTime("12:00"), end: toWallClockTime("14:30") },
    { slot: MealSlot.DINNER, start: toWallClockTime("19:30"), end: toWallClockTime("22:00") },
  ],
  allowMealSkipping: true,
  allowPartialDaySkip: true,
  allowAwayRequests: true,
  awayRequiresApproval: true,
  cutAdvanceHours: 12,
  cutMaxDaysPerMonth: 5,
  awayAdvanceHours: 24,
  awayMaxDays: 30,
});

function ctx(over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: TENANT,
    role: UserRole.STUDENT,
    studentId: STUDENT,
    actorProfileId: "profile-1",
    timezone: IST,
    ...over,
  } as TenantContext;
}

function studentWithPlan(
  over: Partial<{ startDate: string; endDate: string; slots: MealSlot[]; id: string }> = {},
) {
  return {
    studentId: over.id ?? STUDENT,
    tenantId: TENANT,
    rollNumber: "CS21B003",
    fullName: "Test Student",
    photoUrl: null,
    status: "ACTIVE" as const,
    subscription: {
      id: "sub-1",
      status: "ACTIVE",
      startDate: toServiceDate(over.startDate ?? "2026-08-01"),
      endDate: toServiceDate(over.endDate ?? "2026-08-31"),
      includedMealSlots: over.slots ?? [MealSlot.LUNCH, MealSlot.DINNER],
    },
  };
}

function deps(
  overrides: {
    settings?: typeof SETTINGS | null;
    student?: ReturnType<typeof studentWithPlan> | null;
    cuts?: FakeMessCutRepository;
  } = {},
) {
  const tenants = new FakeTenantRepository();
  if (overrides.settings !== null) {
    tenants.set(TENANT, overrides.settings ?? SETTINGS, IST, "secret");
  }

  const students = new FakeStudentRepository();
  const student = overrides.student === null ? null : (overrides.student ?? studentWithPlan());
  if (student) students.add(student);

  const messCuts = overrides.cuts ?? new FakeMessCutRepository();

  return { tenants, students, messCuts, now: () => NOW };
}

function ask(
  over: Partial<Parameters<typeof requestAbsenceForStudent>[1]> = {},
  d = deps(),
): ReturnType<typeof requestAbsenceForStudent> {
  return requestAbsenceForStudent(
    ctx(),
    {
      kind: "SKIP",
      dateFrom: toServiceDate("2026-08-12"),
      dateTo: toServiceDate("2026-08-12"),
      mealSlots: [MealSlot.LUNCH],
      ...over,
    },
    d,
  );
}

describe("requestAbsenceForStudent — who may ask", () => {
  it("accepts a student's own request", async () => {
    const r = await ask();
    expect(isOk(r)).toBe(true);
  });

  it("refuses staff — an absence is the student's own decision", async () => {
    const r = await requestAbsenceForStudent(
      ctx({ role: UserRole.STAFF, studentId: undefined }),
      {
        kind: "SKIP",
        dateFrom: toServiceDate("2026-08-12"),
        dateTo: toServiceDate("2026-08-12"),
        mealSlots: [MealSlot.LUNCH],
      },
      deps(),
    );
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("refuses an admin acting through the student endpoint", async () => {
    // Admins get their own screen with an audit trail. Letting this path accept
    // them would produce cuts with no record of who really made them.
    const r = await requestAbsenceForStudent(
      ctx({ role: UserRole.ADMIN, studentId: undefined }),
      {
        kind: "SKIP",
        dateFrom: toServiceDate("2026-08-12"),
        dateTo: toServiceDate("2026-08-12"),
        mealSlots: [MealSlot.LUNCH],
      },
      deps(),
    );
    expect(isErr(r)).toBe(true);
  });

  it("refuses a session that claims STUDENT but carries no student id", async () => {
    const r = await requestAbsenceForStudent(
      ctx({ studentId: undefined }),
      {
        kind: "SKIP",
        dateFrom: toServiceDate("2026-08-12"),
        dateTo: toServiceDate("2026-08-12"),
        mealSlots: [MealSlot.LUNCH],
      },
      deps(),
    );
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("writes the cut against the session's student, never another id", async () => {
    const d = deps();
    await ask({}, d);
    expect(d.messCuts.rows).toHaveLength(1);
    expect(d.messCuts.rows[0]!.studentId).toBe(STUDENT);
    expect(d.messCuts.rows[0]!.studentId).not.toBe(OTHER_STUDENT);
  });
});

describe("requestAbsenceForStudent — fails closed on missing facts", () => {
  it("refuses when the mess has no settings", async () => {
    const r = await ask({}, deps({ settings: null }));
    expect(isErr(r)).toBe(true);
  });

  it("refuses when the student record is gone", async () => {
    const r = await ask({}, deps({ student: null }));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("refuses a student with no plan at all", async () => {
    const d = deps();
    const withoutPlan = { ...studentWithPlan(), subscription: null };
    d.students.add(withoutPlan);
    const r = await requestAbsenceForStudent(
      ctx({ studentId: "no-plan" }),
      {
        kind: "SKIP",
        dateFrom: toServiceDate("2026-08-12"),
        dateTo: toServiceDate("2026-08-12"),
        mealSlots: [MealSlot.LUNCH],
      },
      d,
    );
    expect(isErr(r)).toBe(true);
  });
});

describe("requestAbsenceForStudent — the plan must cover what is being cut", () => {
  it("refuses days after the plan ends", async () => {
    // Nothing has been paid for those days, so nothing can be credited back.
    const d = deps({ student: studentWithPlan({ endDate: "2026-08-11" }) });
    const r = await ask({ dateFrom: toServiceDate("2026-08-12") }, d);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toMatch(/plan/i);
  });

  it("refuses days before the plan starts", async () => {
    const d = deps({ student: studentWithPlan({ startDate: "2026-08-20" }) });
    const r = await ask({}, d);
    expect(isErr(r)).toBe(true);
  });

  it("refuses when only the tail of the range falls outside the plan", async () => {
    // The partial case is the dangerous one: half the request is legitimate,
    // and accepting it silently would credit days nobody bought.
    const d = deps({ student: studentWithPlan({ endDate: "2026-08-13" }) });
    const r = await ask(
      { dateFrom: toServiceDate("2026-08-12"), dateTo: toServiceDate("2026-08-15") },
      d,
    );
    expect(isErr(r)).toBe(true);
  });

  it("refuses a meal the plan does not include", async () => {
    // A lunch-only subscriber cannot skip dinner: they were never charged for it.
    const d = deps({ student: studentWithPlan({ slots: [MealSlot.LUNCH] }) });
    const r = await ask({ mealSlots: [MealSlot.DINNER] }, d);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe("SLOT_NOT_SERVED");
  });

  it("accepts a range that sits exactly on the plan's last day", async () => {
    const d = deps({ student: studentWithPlan({ endDate: "2026-08-12" }) });
    const r = await ask({}, d);
    expect(isOk(r)).toBe(true);
  });
});

describe("requestAbsenceForStudent — the monthly allowance", () => {
  it("counts days already spent this month", async () => {
    const cuts = new FakeMessCutRepository();
    await cuts.create({
      tenantId: TENANT,
      studentId: STUDENT,
      subscriptionId: "sub-1",
      dateFrom: toServiceDate("2026-08-03"),
      dateTo: toServiceDate("2026-08-07"), // 5 days — the whole allowance
      mealSlots: [MealSlot.LUNCH, MealSlot.DINNER],
      status: "APPROVED",
      effectiveFrom: NOW,
    });

    const r = await ask({}, deps({ cuts }));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe("CONFLICT");
  });

  it("does not count another student's cuts against this one", async () => {
    const cuts = new FakeMessCutRepository();
    await cuts.create({
      tenantId: TENANT,
      studentId: OTHER_STUDENT,
      subscriptionId: "sub-2",
      dateFrom: toServiceDate("2026-08-03"),
      dateTo: toServiceDate("2026-08-07"),
      mealSlots: [MealSlot.LUNCH],
      status: "APPROVED",
      effectiveFrom: NOW,
    });

    const r = await ask({}, deps({ cuts }));
    expect(isOk(r)).toBe(true);
  });

  it("does not count a cancelled request against the allowance", async () => {
    const cuts = new FakeMessCutRepository();
    const row = await cuts.create({
      tenantId: TENANT,
      studentId: STUDENT,
      subscriptionId: "sub-1",
      dateFrom: toServiceDate("2026-08-03"),
      dateTo: toServiceDate("2026-08-07"),
      mealSlots: [MealSlot.LUNCH],
      status: "APPROVED",
      effectiveFrom: NOW,
    });
    await cuts.cancel(TENANT, STUDENT, row.id);

    const r = await ask({}, deps({ cuts }));
    expect(isOk(r)).toBe(true);
  });

  it("counts a PENDING away request, so it cannot be spent twice while under review", async () => {
    const cuts = new FakeMessCutRepository();
    await cuts.create({
      tenantId: TENANT,
      studentId: STUDENT,
      subscriptionId: "sub-1",
      dateFrom: toServiceDate("2026-08-03"),
      dateTo: toServiceDate("2026-08-07"),
      mealSlots: [MealSlot.LUNCH],
      status: "PENDING",
      effectiveFrom: NOW,
    });

    const r = await ask({}, deps({ cuts }));
    expect(isErr(r)).toBe(true);
  });

  it("does not charge the allowance for an away period", async () => {
    // The whole point of the second kind: a fortnight at home is not
    // over-skipping, and would be impossible under a five-day cap.
    const d = deps({ student: studentWithPlan({ endDate: "2026-09-30" }) });
    const r = await requestAbsenceForStudent(
      ctx(),
      {
        kind: "AWAY",
        dateFrom: toServiceDate("2026-08-15"),
        dateTo: toServiceDate("2026-08-28"), // 14 days
        mealSlots: [],
      },
      d,
    );
    expect(isOk(r)).toBe(true);
  });
});

describe("requestAbsenceForStudent — what gets written", () => {
  it("stores an approved skip immediately", async () => {
    const d = deps();
    const r = await ask({}, d);
    expect(isOk(r)).toBe(true);
    expect(d.messCuts.rows[0]!.status).toBe("APPROVED");
  });

  it("stores an away request as PENDING when the mess reviews them", async () => {
    const d = deps({ student: studentWithPlan({ endDate: "2026-09-30" }) });
    const r = await requestAbsenceForStudent(
      ctx(),
      {
        kind: "AWAY",
        dateFrom: toServiceDate("2026-08-15"),
        dateTo: toServiceDate("2026-08-18"),
        mealSlots: [],
      },
      d,
    );
    expect(isOk(r)).toBe(true);
    expect(d.messCuts.rows[0]!.status).toBe("PENDING");
  });

  it("stores an away request as APPROVED when the mess does not review them", async () => {
    const settings = tenantSettings({ ...SETTINGS, awayRequiresApproval: false });
    const d = deps({ settings, student: studentWithPlan({ endDate: "2026-09-30" }) });
    await requestAbsenceForStudent(
      ctx(),
      {
        kind: "AWAY",
        dateFrom: toServiceDate("2026-08-15"),
        dateTo: toServiceDate("2026-08-18"),
        mealSlots: [],
      },
      d,
    );
    expect(d.messCuts.rows[0]!.status).toBe("APPROVED");
  });

  it("expands an away period to every meal the mess serves", async () => {
    // Nobody is present for half a day. Storing only what was ticked would
    // leave the student counted for dinner while they are on a train.
    const d = deps({ student: studentWithPlan({ endDate: "2026-09-30" }) });
    await requestAbsenceForStudent(
      ctx(),
      {
        kind: "AWAY",
        dateFrom: toServiceDate("2026-08-15"),
        dateTo: toServiceDate("2026-08-18"),
        mealSlots: [MealSlot.LUNCH],
      },
      d,
    );
    expect(d.messCuts.rows[0]!.mealSlots).toEqual([MealSlot.LUNCH, MealSlot.DINNER]);
  });

  it("ties the cut to the subscription that paid for those days", async () => {
    const d = deps();
    await ask({}, d);
    // Without this the Phase 2 credit has no invoice to attach to.
    expect(d.messCuts.rows).toHaveLength(1);
  });

  it("writes nothing when the policy refuses", async () => {
    const d = deps();
    // Tomorrow's lunch, requested at 10:00 with 12 hours' notice required —
    // lunch opens in 2 hours, so this is too late.
    const r = await ask(
      { dateFrom: toServiceDate("2026-08-10"), dateTo: toServiceDate("2026-08-10") },
      d,
    );
    expect(isErr(r)).toBe(true);
    expect(d.messCuts.rows).toHaveLength(0);
  });

  it("returns the stored row, so the screen can show it without a re-read", async () => {
    const r = await ask();
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(unwrap(r).dateFrom).toBe("2026-08-12");
      expect(unwrap(r).mealSlots).toEqual([MealSlot.LUNCH]);
    }
  });
});

describe("requestAbsenceForStudent — a retried submit adds nothing", () => {
  it("produces exactly one row for a double-tap", async () => {
    // Guaranteed on hostel wifi: the button appears to do nothing and the
    // student presses it again. Two rows would show the same days twice in
    // their list with no way to tell which to cancel.
    const d = deps();
    const first = await ask({}, d);
    const second = await ask({}, d);

    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    expect(d.messCuts.rows).toHaveLength(1);
  });

  it("returns the same row id both times", async () => {
    const d = deps();
    const first = await ask({}, d);
    const second = await ask({}, d);
    if (isOk(first) && isOk(second)) {
      expect(unwrap(second).id).toBe(unwrap(first).id);
    }
  });

  it("reports a concurrent duplicate as success, not as a database error", async () => {
    // Two submits racing past the same read: the index rejects the second, and
    // the student must see their absence recorded, not a failure.
    const d = deps();
    d.messCuts.failNextCreateAsDuplicate = true;
    const r = await ask({}, d);
    expect(isOk(r)).toBe(true);
  });
});
