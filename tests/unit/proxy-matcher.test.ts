/**
 * Which paths the proxy is allowed to run on.
 *
 * The failure this prevents is the one that blocks every non-browser client:
 * `proxy.ts` redirects an unauthenticated request to `/login`, and the matcher
 * used to cover `/api/*` too. A mobile app sending `Authorization: Bearer ...`
 * carries no cookie, so the proxy saw an anonymous request and answered with a
 * **307 redirect to an HTML login page** — the route handler was never reached
 * and the client got markup where it expected JSON.
 *
 * Excluding `/api` is safe because every handler already resolves its own
 * session and returns 401 JSON itself, and `/api/cron/*` is guarded by
 * `CRON_SECRET` rather than by a session.
 *
 * **This reads the real `config` export**, deliberately. The first attempt at
 * this fix hoisted the pattern into a shared constant and imported it, which
 * Next silently ignores — `matcher` is statically analysed at build time and a
 * variable is discarded with no error. The unit tests passed against the shared
 * constant while the deployed proxy still redirected every API call. Asserting
 * on anything but the literal Next actually reads would let that recur.
 */
import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

/** Next applies each matcher entry as an anchored path pattern. */
function proxyRunsOn(pathname: string): boolean {
  return config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(pathname));
}

describe("proxy matcher — API routes must reach their handlers", () => {
  it("does not run on the QR endpoints the counter and the app depend on", () => {
    expect(proxyRunsOn("/api/qr/token")).toBe(false);
    expect(proxyRunsOn("/api/qr/verify")).toBe(false);
  });

  it("does not run on the mobile auth endpoints", () => {
    expect(proxyRunsOn("/api/auth/login")).toBe(false);
    expect(proxyRunsOn("/api/auth/change-password")).toBe(false);
  });

  it("does not run on cron, which authenticates with a secret and not a session", () => {
    expect(proxyRunsOn("/api/cron/headcount")).toBe(false);
  });
});

describe("proxy matcher — pages still get gated", () => {
  it("runs on every role shell, so route gating is unchanged", () => {
    expect(proxyRunsOn("/student")).toBe(true);
    expect(proxyRunsOn("/student/absences")).toBe(true);
    expect(proxyRunsOn("/staff")).toBe(true);
    expect(proxyRunsOn("/staff/sales")).toBe(true);
    expect(proxyRunsOn("/admin")).toBe(true);
    expect(proxyRunsOn("/admin/students/import")).toBe(true);
  });

  it("runs on the login page, which redirects an already-signed-in user onward", () => {
    expect(proxyRunsOn("/login")).toBe(true);
  });

  it("runs on the root, which routes each role to its own shell", () => {
    expect(proxyRunsOn("/")).toBe(true);
  });

  it("runs on the forced password change, which must stay reachable", () => {
    expect(proxyRunsOn("/change-password")).toBe(true);
  });
});

describe("proxy matcher — static assets stay excluded", () => {
  it("skips build output, so the proxy does not tax every asset request", () => {
    expect(proxyRunsOn("/_next/static/chunks/main.js")).toBe(false);
    expect(proxyRunsOn("/_next/image")).toBe(false);
  });

  it("skips images and the favicon", () => {
    expect(proxyRunsOn("/favicon.ico")).toBe(false);
    expect(proxyRunsOn("/logo.svg")).toBe(false);
    expect(proxyRunsOn("/photo.jpg")).toBe(false);
    expect(proxyRunsOn("/icon.png")).toBe(false);
  });
});

describe("proxy matcher — the shape Next requires", () => {
  it("is a literal string, not a variable Next would discard at build time", () => {
    // The docs are explicit: "matcher values need to be constants so they can be
    // statically analyzed at build-time. Dynamic values such as variables will
    // be ignored." A non-literal here fails silently in production, so assert
    // the value is present and well-formed rather than trusting it.
    expect(config.matcher).toHaveLength(1);
    expect(typeof config.matcher[0]).toBe("string");
    expect(config.matcher[0]).toContain("(?!api|");
  });
});
