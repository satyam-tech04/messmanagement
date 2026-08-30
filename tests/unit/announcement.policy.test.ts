/**
 * Special-meal announcements, and the feedback students leave.
 *
 * Both are gated by a tenant toggle and both are deliberately small. What makes
 * them worth testing is the two rules that are easy to get wrong:
 *
 *   **Visibility is derived, never stored.** Nothing in this system runs on a
 *   schedule, so an announcement must appear and disappear on its own from its
 *   date window — the same reason `subscription-state.ts` and `pause.policy.ts`
 *   derive their states rather than trusting a column.
 *
 *   **One verdict per meal.** A student rates a given meal on a given day once.
 *   Re-submitting replaces their answer rather than stacking a second one, so
 *   the admin's averages cannot be moved by whoever taps hardest.
 */
import { describe, expect, it } from "vitest";
import {
  announcementStateOf,
  isAnnouncementVisibleOn,
  parseAnnouncementDraft,
  visibleAnnouncements,
  type AnnouncementDates,
  type AnnouncementDraftInput,
} from "@/core/policies/announcement.policy";
import {
  averageRating,
  parseFeedbackDraft,
  ratingBreakdown,
  type FeedbackDraftInput,
} from "@/core/policies/feedback.policy";
import { toServiceDate } from "@/core/time";

const d = toServiceDate;
const today = d("2026-09-10");

function announcement(over: Partial<AnnouncementDates> = {}): AnnouncementDates {
  return {
    status: "PUBLISHED",
    startsOn: d("2026-09-08"),
    endsOn: d("2026-09-12"),
    ...over,
  };
}

function draft(over: Partial<AnnouncementDraftInput> = {}): AnnouncementDraftInput {
  return {
    actorRole: "ADMIN",
    title: "Onam Sadhya",
    body: "Payasam, avial, thoran, sambar.",
    startsOn: d("2026-09-08"),
    endsOn: d("2026-09-12"),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Announcement visibility — derived from dates, with no job to run
// ---------------------------------------------------------------------------

describe("announcementStateOf", () => {
  it("is SCHEDULED before the window opens", () => {
    expect(announcementStateOf(announcement(), d("2026-09-07"))).toBe("SCHEDULED");
  });

  it("is LIVE on the first day, inclusive", () => {
    expect(announcementStateOf(announcement(), d("2026-09-08"))).toBe("LIVE");
  });

  it("is LIVE on the last day, inclusive", () => {
    // Inclusive at both ends, unlike a pause. An announcement about Sunday
    // lunch must still be on screen on Sunday.
    expect(announcementStateOf(announcement(), d("2026-09-12"))).toBe("LIVE");
  });

  it("is FINISHED the day after the window closes", () => {
    expect(announcementStateOf(announcement(), d("2026-09-13"))).toBe("FINISHED");
  });

  it("is ARCHIVED whatever the dates say", () => {
    expect(announcementStateOf(announcement({ status: "ARCHIVED" }), today)).toBe("ARCHIVED");
  });
});

describe("isAnnouncementVisibleOn", () => {
  it("shows a live announcement", () => {
    expect(isAnnouncementVisibleOn(announcement(), today)).toBe(true);
  });

  it("hides an archived one immediately, even mid-window", () => {
    expect(isAnnouncementVisibleOn(announcement({ status: "ARCHIVED" }), today)).toBe(false);
  });

  it("hides one that has not started", () => {
    expect(isAnnouncementVisibleOn(announcement(), d("2026-09-01"))).toBe(false);
  });

  it("hides one that has finished — with nothing having run to expire it", () => {
    expect(isAnnouncementVisibleOn(announcement(), d("2026-10-01"))).toBe(false);
  });
});

describe("visibleAnnouncements", () => {
  it("keeps only what is live today, newest window first", () => {
    const rows = [
      { ...announcement({ startsOn: d("2026-09-01"), endsOn: d("2026-09-02") }), id: "old" },
      { ...announcement({ startsOn: d("2026-09-09"), endsOn: d("2026-09-11") }), id: "now" },
      { ...announcement({ startsOn: d("2026-09-20"), endsOn: d("2026-09-21") }), id: "later" },
    ];
    const visible = visibleAnnouncements(rows, today);
    expect(visible.map((a) => a.id)).toEqual(["now"]);
  });

  it("returns an empty list rather than null when nothing is live", () => {
    // The student screen renders nothing at all in that case — no empty card
    // taking up room on the one screen they use at a counter.
    expect(visibleAnnouncements([], today)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Creating an announcement
// ---------------------------------------------------------------------------

describe("parseAnnouncementDraft", () => {
  it("accepts a valid announcement", () => {
    expect(parseAnnouncementDraft(draft()).ok).toBe(true);
  });

  it("requires a title", () => {
    expect(parseAnnouncementDraft(draft({ title: "   " })).ok).toBe(false);
  });

  it("trims the title and body", () => {
    const r = parseAnnouncementDraft(draft({ title: "  Onam  ", body: "  Sadhya  " }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe("Onam");
    expect(r.value.body).toBe("Sadhya");
  });

  it("allows an empty body — a title alone is a complete announcement", () => {
    const r = parseAnnouncementDraft(draft({ body: "" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.body).toBeNull();
  });

  it("rejects an end date before the start", () => {
    expect(parseAnnouncementDraft(draft({ endsOn: d("2026-09-01") })).ok).toBe(false);
  });

  it("allows a window starting in the past", () => {
    // Posting today about today is the ordinary case, and the mess should not
    // have to backdate anything to do it.
    expect(parseAnnouncementDraft(draft({ startsOn: d("2020-01-01") })).ok).toBe(true);
  });

  it("refuses staff — only an admin announces (B6)", () => {
    const r = parseAnnouncementDraft(draft({ actorRole: "STAFF" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("refuses students", () => {
    expect(parseAnnouncementDraft(draft({ actorRole: "STUDENT" })).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

function feedback(over: Partial<FeedbackDraftInput> = {}): FeedbackDraftInput {
  return {
    actorRole: "STUDENT",
    featureEnabled: true,
    rating: 4,
    comment: "Good dosa",
    serviceDate: today,
    today,
    mealSlot: "LUNCH",
    ...over,
  };
}

describe("parseFeedbackDraft", () => {
  it("accepts a rating with a comment", () => {
    const r = parseFeedbackDraft(feedback());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rating).toBe(4);
  });

  it("accepts a rating with no comment — a star alone is feedback", () => {
    const r = parseFeedbackDraft(feedback({ comment: "" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.comment).toBeNull();
  });

  it("rejects a rating outside one to five", () => {
    expect(parseFeedbackDraft(feedback({ rating: 0 })).ok).toBe(false);
    expect(parseFeedbackDraft(feedback({ rating: 6 })).ok).toBe(false);
    expect(parseFeedbackDraft(feedback({ rating: 3.5 })).ok).toBe(false);
  });

  it("rejects an over-long comment", () => {
    expect(parseFeedbackDraft(feedback({ comment: "x".repeat(1001) })).ok).toBe(false);
  });

  it("refuses when the mess has the feature switched off", () => {
    // Checked here, not only in the UI: a hidden form is not a closed door, and
    // the action must refuse a request that arrives anyway.
    const r = parseFeedbackDraft(feedback({ featureEnabled: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("rejects feedback about a meal in the future", () => {
    // Nobody can have an opinion about tomorrow's lunch.
    const r = parseFeedbackDraft(feedback({ serviceDate: d("2026-09-11") }));
    expect(r.ok).toBe(false);
  });

  it("accepts feedback about today", () => {
    expect(parseFeedbackDraft(feedback({ serviceDate: today })).ok).toBe(true);
  });

  it("rejects feedback about a meal too long ago to remember", () => {
    const r = parseFeedbackDraft(feedback({ serviceDate: d("2026-08-01") }));
    expect(r.ok).toBe(false);
  });

  it("allows an admin to record feedback on a student's behalf", () => {
    // Some students will say it at the counter rather than type it. The staff
    // path exists so that is not lost.
    expect(parseFeedbackDraft(feedback({ actorRole: "ADMIN" })).ok).toBe(true);
  });
});

describe("summarising feedback for the admin", () => {
  const ratings = [5, 4, 4, 2, 1];

  it("averages to one decimal place", () => {
    expect(averageRating(ratings)).toBe(3.2);
  });

  it("returns null for no ratings rather than zero", () => {
    // Zero would read as "everybody hated it" on the dashboard, which is the
    // opposite of "nobody has said anything yet".
    expect(averageRating([])).toBeNull();
  });

  it("counts each star level, including the ones nobody chose", () => {
    expect(ratingBreakdown(ratings)).toEqual({ 1: 1, 2: 1, 3: 0, 4: 2, 5: 1 });
  });
});
