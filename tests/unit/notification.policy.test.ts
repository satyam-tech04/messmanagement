/**
 * What a notification says, and who is allowed to be woken by it.
 *
 * Push is the only part of this product that reaches a student when they are
 * not using it. Every case below is about restraint: the student who opted out,
 * the student who has left, the retry that must not buzz a second time, and the
 * hour at which a plan reminder is simply rude.
 */
import { describe, expect, it } from "vitest";
import {
  NotificationKind,
  buildNotification,
  deliveryKey,
  isWithinSendingHours,
  parseManualNotification,
  wantsNotification,
} from "@/core/policies/notification.policy";
import { toServiceDate } from "@/core/time";
import { isErr, isOk } from "@/core/result";

describe("who wants it", () => {
  const active = { studentStatus: "ACTIVE" as const, optOuts: [] as string[] };

  it("notifies an ordinary student", () => {
    expect(wantsNotification(NotificationKind.ANNOUNCEMENT, active)).toBe(true);
  });

  it("respects an opt-out, for that kind only", () => {
    const muted = { ...active, optOuts: ["MENU_PUBLISHED"] };
    expect(wantsNotification(NotificationKind.MENU_PUBLISHED, muted)).toBe(false);
    // Silencing the daily menu must not silence the one that says their plan
    // has run out — that is the notification they would actually miss.
    expect(wantsNotification(NotificationKind.PLAN_REMINDER, muted)).toBe(true);
  });

  it("never notifies a student who has left", () => {
    // INACTIVE covers both a student who left the hostel and one who asked to
    // be deleted (D-32). Buzzing either is indefensible.
    const gone = { ...active, studentStatus: "INACTIVE" as const };
    for (const kind of Object.values(NotificationKind)) {
      expect(wantsNotification(kind, gone)).toBe(false);
    }
  });

  it("still tells a blocked student their plan has lapsed", () => {
    // BLOCKED means unpaid, so this is precisely the student who needs to know.
    const blocked = { ...active, studentStatus: "BLOCKED" as const };
    expect(wantsNotification(NotificationKind.PLAN_REMINDER, blocked)).toBe(true);
  });
});

describe("what it says", () => {
  it("names the mess, because a phone shows it next to every other app", () => {
    const message = buildNotification({
      kind: NotificationKind.ANNOUNCEMENT,
      tenantName: "Campus Crave",
      title: "Sunday special: biryani",
      body: "Lunch only, 12:00–14:30.",
    });

    expect(message.title).toContain("Campus Crave");
    expect(message.body).toBe("Lunch only, 12:00–14:30.");
  });

  it("sends the student to the screen the notification is about", () => {
    // A notification that opens the home screen makes the reader hunt for what
    // they were just told.
    expect(
      buildNotification({
        kind: NotificationKind.ABSENCE_DECISION,
        tenantName: "Campus Crave",
        title: "Away request approved",
        body: "3–5 October.",
      }).route,
    ).toBe("/absences");

    expect(
      buildNotification({
        kind: NotificationKind.MENU_PUBLISHED,
        tenantName: "Campus Crave",
        title: "Tomorrow's menu is up",
        body: "Lunch and dinner.",
      }).route,
    ).toBe("/menu");

    expect(
      buildNotification({
        kind: NotificationKind.PLAN_REMINDER,
        tenantName: "Campus Crave",
        title: "Your plan ends on Friday",
        body: "Renew to keep eating.",
      }).route,
    ).toBe("/plan");
  });

  it("truncates a body long enough to be cut off mid-word by the OS", () => {
    const message = buildNotification({
      kind: NotificationKind.ANNOUNCEMENT,
      tenantName: "Campus Crave",
      title: "Notice",
      body: "x".repeat(400),
    });

    expect(message.body.length).toBeLessThanOrEqual(180);
    expect(message.body.endsWith("…")).toBe(true);
  });

  it("carries the kind, so the app can route and count without parsing text", () => {
    const message = buildNotification({
      kind: NotificationKind.ANNOUNCEMENT,
      tenantName: "Campus Crave",
      title: "Notice",
      body: "Something",
    });

    expect(message.kind).toBe("ANNOUNCEMENT");
  });
});

describe("sending twice", () => {
  it("keys an announcement to the announcement itself", () => {
    // Publishing, editing and republishing the same announcement must not buzz
    // 300 phones twice.
    expect(deliveryKey(NotificationKind.ANNOUNCEMENT, { id: "ann-1" })).toBe("ANNOUNCEMENT:ann-1");
  });

  it("keys a plan reminder to the student and the day", () => {
    // The cron runs daily and is retried on failure. One student, one day, one
    // reminder — however many times it runs.
    const key = deliveryKey(NotificationKind.PLAN_REMINDER, {
      id: "student-1",
      date: toServiceDate("2026-09-21"),
    });
    expect(key).toBe("PLAN_REMINDER:student-1:2026-09-21");
  });

  it("gives two different events two different keys", () => {
    expect(deliveryKey(NotificationKind.MENU_PUBLISHED, { id: "2026-09-21" })).not.toBe(
      deliveryKey(NotificationKind.MENU_PUBLISHED, { id: "2026-09-22" }),
    );
  });
});

describe("the hour", () => {
  // The plan reminder is the one nobody asked for at that moment, and the cron
  // that sends it runs on our schedule, not the student's.
  it("allows a reasonable daytime hour", () => {
    expect(isWithinSendingHours("Asia/Kolkata", new Date("2026-09-21T04:30:00Z"))).toBe(true);
  });

  it("refuses the middle of the night, in the mess's own timezone", () => {
    // 21:00 UTC is 02:30 in Kolkata. A UTC-based check would have sent this.
    expect(isWithinSendingHours("Asia/Kolkata", new Date("2026-09-21T21:00:00Z"))).toBe(false);
  });

  it("refuses early morning before anyone is awake", () => {
    // 00:30 UTC is 06:00 in Kolkata — before the 07:00 floor.
    expect(isWithinSendingHours("Asia/Kolkata", new Date("2026-09-21T00:30:00Z"))).toBe(false);
  });
});

describe("an admin writing a message by hand", () => {
  const ok = { actorRole: "ADMIN" as const, title: "Water supply", body: "Back by 6pm." };

  it("accepts a written message from an admin", () => {
    const parsed = parseManualNotification(ok);
    expect(isOk(parsed)).toBe(true);
    if (isOk(parsed)) expect(parsed.value.title).toBe("Water supply");
  });

  it("refuses counter staff", () => {
    // Staff verify meals. Writing to every student's lock screen is a
    // different authority, and an unrecallable one.
    const parsed = parseManualNotification({ ...ok, actorRole: "STAFF" });
    expect(isErr(parsed)).toBe(true);
    if (isErr(parsed)) expect(parsed.error.code).toBe("FORBIDDEN");
  });

  it("refuses an empty title or body", () => {
    // A notification with no body is a buzz with nothing in it.
    for (const bad of [{ title: "   " }, { body: "" }]) {
      const parsed = parseManualNotification({ ...ok, ...bad });
      expect(isErr(parsed)).toBe(true);
      if (isErr(parsed)) expect(parsed.error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("refuses a title too long to survive a lock screen", () => {
    const parsed = parseManualNotification({ ...ok, title: "x".repeat(100) });
    expect(isErr(parsed)).toBe(true);
  });

  it("trims what the admin typed", () => {
    const parsed = parseManualNotification({ ...ok, title: "  Notice  ", body: " Hello " });
    expect(isOk(parsed)).toBe(true);
    if (isOk(parsed)) {
      expect(parsed.value.title).toBe("Notice");
      expect(parsed.value.body).toBe("Hello");
    }
  });
});
