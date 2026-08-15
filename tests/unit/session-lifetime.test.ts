/**
 * Sessions must survive a closed browser and a rebooted counter tablet.
 *
 * The failure this prevents is operational, not theoretical: staff arriving at
 * 07:00 to a login screen with a queue already forming, because the tablet
 * restarted overnight and the auth cookie was a session cookie.
 *
 * The one thing it must NOT do is keep a cookie alive that the library is
 * trying to clear — that would resurrect a token during sign-out.
 */
import { describe, expect, it } from "vitest";
import {
  persistentCookieOptions,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from "@/infra/auth/session-lifetime";

describe("persistentCookieOptions — keeping people signed in", () => {
  it("gives a session cookie a long life", () => {
    const out = persistentCookieOptions("a-token", { path: "/" });
    expect(out.maxAge).toBe(SESSION_COOKIE_MAX_AGE_SECONDS);
  });

  it("lasts a year, so no ordinary gap in usage ends a session", () => {
    expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBe(31_536_000);
  });

  it("overrides a short lifetime the library asked for", () => {
    const out = persistentCookieOptions("a-token", { maxAge: 3600, path: "/" });
    expect(out.maxAge).toBe(SESSION_COOKIE_MAX_AGE_SECONDS);
  });

  it("drops `expires`, which would otherwise win and cut the session short", () => {
    const out = persistentCookieOptions("a-token", {
      expires: new Date(Date.now() + 60_000),
      path: "/",
    });
    expect(out.expires).toBeUndefined();
    expect(out.maxAge).toBe(SESSION_COOKIE_MAX_AGE_SECONDS);
  });
});

describe("persistentCookieOptions — never resurrect a cleared cookie", () => {
  it("leaves an empty value alone — that is a sign-out", () => {
    const out = persistentCookieOptions("", { maxAge: 0, path: "/" });
    expect(out.maxAge).toBe(0);
  });

  it("leaves a zero maxAge alone even with a value present", () => {
    const out = persistentCookieOptions("stale", { maxAge: 0, path: "/" });
    expect(out.maxAge).toBe(0);
  });

  it("leaves a negative maxAge alone", () => {
    const out = persistentCookieOptions("stale", { maxAge: -1, path: "/" });
    expect(out.maxAge).toBe(-1);
  });

  it("leaves a past `expires` alone", () => {
    const past = new Date(Date.now() - 60_000);
    const out = persistentCookieOptions("stale", { expires: past, path: "/" });
    expect(out.expires).toBe(past);
  });
});

describe("persistentCookieOptions — security properties are untouched", () => {
  it("preserves httpOnly, secure, sameSite and path", () => {
    const out = persistentCookieOptions("a-token", {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
      domain: "example.test",
    });
    expect(out.httpOnly).toBe(true);
    expect(out.secure).toBe(true);
    expect(out.sameSite).toBe("lax");
    expect(out.path).toBe("/");
    expect(out.domain).toBe("example.test");
  });

  it("copes with no options at all", () => {
    const out = persistentCookieOptions("a-token", undefined);
    expect(out.maxAge).toBe(SESSION_COOKIE_MAX_AGE_SECONDS);
  });
});
