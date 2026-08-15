/**
 * Tests for the scanner's admission gate.
 *
 * The camera reads the same QR code dozens of times a second. Something has to
 * decide which of those reads becomes a request, and it has two failure modes
 * that pull in opposite directions:
 *
 *   * **Too permissive** — every successful scan is immediately followed by an
 *     ALREADY_SERVED for the same student, because the code was still on screen.
 *   * **Too strict** — a read dropped while another request is in flight gets
 *     remembered as "seen", so the retry milliseconds later is also suppressed
 *     and the scan is lost silently. The student walks off unserved and nobody
 *     finds out until the headcount is wrong.
 *
 * The second one is the bug this file was written for: a token must only be
 * remembered once it has actually been sent.
 */
import { describe, expect, it } from "vitest";
import { DEDUPE_MS, shouldSubmitToken, type LastScan } from "@/lib/scan-gate";

const T0 = 1_000_000;
const TOKEN = "eyJ0IjoiYSJ9.sig";
const OTHER = "eyJ0IjoiYiJ9.sig";

describe("shouldSubmitToken — a fresh code is sent", () => {
  it("accepts the first read of a token", () => {
    expect(shouldSubmitToken({ token: TOKEN, last: null, now: T0, busy: false })).toBe(true);
  });

  it("accepts a different student's code immediately", () => {
    // The queue moves faster than the dedupe window; the next student must not
    // wait three seconds because the previous one just scanned.
    const last: LastScan = { token: TOKEN, at: T0 };
    expect(shouldSubmitToken({ token: OTHER, last, now: T0 + 50, busy: false })).toBe(true);
  });
});

describe("shouldSubmitToken — the same code is not sent twice", () => {
  it("refuses a re-read within the dedupe window", () => {
    const last: LastScan = { token: TOKEN, at: T0 };
    expect(shouldSubmitToken({ token: TOKEN, last, now: T0 + 100, busy: false })).toBe(false);
  });

  it("refuses it at the very end of the window", () => {
    const last: LastScan = { token: TOKEN, at: T0 };
    expect(shouldSubmitToken({ token: TOKEN, last, now: T0 + DEDUPE_MS - 1, busy: false })).toBe(
      false,
    );
  });

  it("accepts it once the window has passed", () => {
    // A student legitimately re-presenting after a failure, e.g. staff hit
    // "Next student" and the same code is still on screen.
    const last: LastScan = { token: TOKEN, at: T0 };
    expect(shouldSubmitToken({ token: TOKEN, last, now: T0 + DEDUPE_MS, busy: false })).toBe(true);
  });
});

describe("shouldSubmitToken — a read dropped while busy is not remembered", () => {
  it("refuses to send while a request is in flight", () => {
    expect(shouldSubmitToken({ token: OTHER, last: null, now: T0, busy: true })).toBe(false);
  });

  it("accepts that same token the moment the request finishes", () => {
    // The whole point: because the busy read was never recorded, the camera's
    // next read of the same code — milliseconds later — still gets through.
    // Under the old code the token was marked seen before the busy check, and
    // this scan vanished for three seconds with no feedback to staff.
    expect(shouldSubmitToken({ token: OTHER, last: null, now: T0 + 5, busy: false })).toBe(true);
  });

  it("still dedupes a token that was genuinely sent, even after a busy gap", () => {
    const last: LastScan = { token: TOKEN, at: T0 };
    expect(shouldSubmitToken({ token: TOKEN, last, now: T0 + 5, busy: true })).toBe(false);
    expect(shouldSubmitToken({ token: TOKEN, last, now: T0 + 10, busy: false })).toBe(false);
  });
});

describe("DEDUPE_MS", () => {
  it("is long enough to outlast a result panel but shorter than a code's life", () => {
    // Shorter than the QR TTL (10s minimum, enforced in tenant settings), or a
    // student could be double-served on one code. Longer than the success
    // panel, or the code still on their screen re-fires the instant it clears.
    expect(DEDUPE_MS).toBeGreaterThanOrEqual(2000);
    expect(DEDUPE_MS).toBeLessThan(10_000);
  });
});
