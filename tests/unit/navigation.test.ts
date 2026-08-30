/**
 * Navigation is feature-gated, and getting that wrong is visible to every user.
 *
 * A mess that has not turned absences on must not show its students a way to
 * skip meals — the link would work, the policy would refuse, and the student
 * would be told "this mess does not let students skip meals" by a page that
 * just invited them to. The gate belongs in the nav, not only in the policy.
 *
 * The reverse failure is quieter and worse: the admin enables the feature and
 * nothing appears, so they conclude it is broken.
 */
import { describe, expect, it } from "vitest";
import { UserRole } from "@/core/domain/enums";
import { navigationFor, type NavSection } from "@/lib/navigation";

const hrefs = (sections: readonly NavSection[]): string[] =>
  sections.flatMap((s) => s.items.map((i) => i.href));

describe("navigationFor — absences are hidden until the mess enables them", () => {
  it("hides the link when neither skipping nor away requests are on", () => {
    const nav = navigationFor(UserRole.STUDENT, {
      allowMealSkipping: false,
      allowAwayRequests: false,
    });
    expect(hrefs(nav)).not.toContain("/student/absences");
  });

  it("shows it when skipping is enabled", () => {
    const nav = navigationFor(UserRole.STUDENT, {
      allowMealSkipping: true,
      allowAwayRequests: false,
    });
    expect(hrefs(nav)).toContain("/student/absences");
  });

  it("shows it when only away requests are enabled", () => {
    // The two toggles are independent — a mess may take holiday notice without
    // allowing single-meal skips.
    const nav = navigationFor(UserRole.STUDENT, {
      allowMealSkipping: false,
      allowAwayRequests: true,
    });
    expect(hrefs(nav)).toContain("/student/absences");
  });

  it("hides it by default when no feature flags are supplied", () => {
    // Fails closed: a caller that forgets to pass settings shows nothing rather
    // than exposing a feature the mess never turned on.
    expect(hrefs(navigationFor(UserRole.STUDENT))).not.toContain("/student/absences");
  });

  it("never shows it to staff or admins — they have their own screens", () => {
    const flags = { allowMealSkipping: true, allowAwayRequests: true };
    expect(hrefs(navigationFor(UserRole.STAFF, flags))).not.toContain("/student/absences");
    expect(hrefs(navigationFor(UserRole.ADMIN, flags))).not.toContain("/student/absences");
  });
});

describe("navigationFor — the rest of the nav is unaffected", () => {
  it("keeps the student's core links whatever the flags say", () => {
    for (const flags of [
      { allowMealSkipping: false, allowAwayRequests: false },
      { allowMealSkipping: true, allowAwayRequests: true },
    ]) {
      const links = hrefs(navigationFor(UserRole.STUDENT, flags));
      expect(links).toContain("/student");
      expect(links).toContain("/student/menu");
      expect(links).toContain("/student/plan");
    }
  });

  it("gives an admin the absence review screen", () => {
    expect(hrefs(navigationFor(UserRole.ADMIN))).toContain("/admin/absences");
  });

  it("gives a super admin everything an admin gets, plus the mess switcher", () => {
    const superAdmin = hrefs(navigationFor(UserRole.SUPER_ADMIN));

    for (const href of hrefs(navigationFor(UserRole.ADMIN))) {
      expect(superAdmin).toContain(href);
    }
    expect(superAdmin).toContain("/admin/messes");
  });

  it("hides the mess switcher from a mess admin, who runs exactly one hostel", () => {
    expect(hrefs(navigationFor(UserRole.ADMIN))).not.toContain("/admin/messes");
    expect(hrefs(navigationFor(UserRole.STAFF))).not.toContain("/admin/messes");
    expect(hrefs(navigationFor(UserRole.STUDENT))).not.toContain("/admin/messes");
  });

  it("never leaves a section with no items", () => {
    // An empty section renders as a heading with nothing under it.
    for (const role of [UserRole.STUDENT, UserRole.STAFF, UserRole.ADMIN]) {
      for (const section of navigationFor(role)) {
        expect(section.items.length).toBeGreaterThan(0);
      }
    }
  });

  it("has no duplicate hrefs, which would highlight two links at once", () => {
    for (const role of [UserRole.STUDENT, UserRole.STAFF, UserRole.ADMIN]) {
      const links = hrefs(
        navigationFor(role, { allowMealSkipping: true, allowAwayRequests: true }),
      );
      expect(new Set(links).size).toBe(links.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Announcements and feedback (migration 016)
//
// Both are behind a per-mess toggle. These matter because the toggle is the
// only thing standing between a mess that has not asked for feedback and a
// student screen that invites them to leave some.
// ---------------------------------------------------------------------------

describe("feature toggles reach the navigation", () => {
  const hrefs = (role: Parameters<typeof navigationFor>[0], features = {}) =>
    navigationFor(role, features)
      .flatMap((section) => section.items)
      .map((item) => item.href);

  it("hides student feedback when the mess has not switched it on", () => {
    // The default. Feedback is the one place a student writes to this system,
    // so it must not appear merely because a deploy happened.
    expect(hrefs("STUDENT")).not.toContain("/student/feedback");
  });

  it("shows student feedback once it is on", () => {
    expect(hrefs("STUDENT", { allowFeedback: true })).toContain("/student/feedback");
  });

  it("never shows a student the admin's review screen", () => {
    const student = hrefs("STUDENT", { allowFeedback: true, allowAnnouncements: true });
    expect(student).not.toContain("/admin/feedback");
    expect(student).not.toContain("/admin/announcements");
  });

  it("hides both admin screens until their toggles are on", () => {
    const admin = hrefs("ADMIN");
    expect(admin).not.toContain("/admin/announcements");
    expect(admin).not.toContain("/admin/feedback");
  });

  it("shows each admin screen independently", () => {
    expect(hrefs("ADMIN", { allowAnnouncements: true })).toContain("/admin/announcements");
    expect(hrefs("ADMIN", { allowAnnouncements: true })).not.toContain("/admin/feedback");
    expect(hrefs("ADMIN", { allowFeedback: true })).toContain("/admin/feedback");
  });

  it("gives the platform operator the same screens as the mess admin", () => {
    // SUPER_ADMIN supports customers, so it must see what their admin sees.
    // It previously read a frozen ADMIN_NAV and would have missed both.
    const superAdmin = hrefs("SUPER_ADMIN", { allowAnnouncements: true, allowFeedback: true });
    expect(superAdmin).toContain("/admin/announcements");
    expect(superAdmin).toContain("/admin/feedback");
    expect(superAdmin).toContain("/admin/messes");
  });

  it("does not mutate the shared admin nav between calls", () => {
    // adminNav copies before pushing. Without that, one request with the
    // toggles on would leave the entries visible to every later request,
    // including other messes'.
    hrefs("ADMIN", { allowAnnouncements: true, allowFeedback: true });
    expect(hrefs("ADMIN")).not.toContain("/admin/announcements");
    expect(hrefs("ADMIN")).not.toContain("/admin/feedback");
  });
});
