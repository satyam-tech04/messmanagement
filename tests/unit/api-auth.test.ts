/**
 * The gate every JSON endpoint sits behind.
 *
 * The hole this closes is real and specific. `must_change_password` forces a
 * student off the temporary password an admin issued them — one derived from
 * their own phone number and therefore known to whoever created the account.
 * On the web that gate lives in `src/app/(app)/layout.tsx`, and `/api/*` sits
 * outside that layout entirely. So the moment a mobile client exists, an
 * account could be used indefinitely on its admin-known password by talking to
 * the API and never loading a page.
 *
 * The one deliberate exception is the change-password endpoint itself, which
 * must stay reachable while the flag is still set — otherwise the only way to
 * clear it is a route the user is locked out of.
 */
import { describe, expect, it } from "vitest";
import { apiAuthDecision } from "@/infra/http/api-auth-decision";
import type { SessionUser } from "@/infra/auth/session";

function sessionUser(over: Partial<SessionUser> = {}): SessionUser {
  return {
    tenantId: "11111111-1111-1111-1111-111111111111",
    tenantSlug: "campus-crave",
    timezone: "Asia/Kolkata",
    actorProfileId: "22222222-2222-2222-2222-222222222222",
    role: "STUDENT",
    studentId: "33333333-3333-3333-3333-333333333333",
    mustChangePassword: false,
    fullName: "Asha Rao",
    profileStatus: "ACTIVE",
    ...over,
  };
}

describe("apiAuthDecision — no session", () => {
  it("refuses an unauthenticated caller with 401", () => {
    const decision = apiAuthDecision(null);
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("UNAUTHENTICATED");
    expect(decision.status).toBe(401);
  });

  it("still refuses when the change-password exception is in play", () => {
    // The exception loosens which *authenticated* users may proceed. It must
    // never admit someone with no session at all.
    const decision = apiAuthDecision(null, { allowPasswordChangePending: true });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("UNAUTHENTICATED");
  });
});

describe("apiAuthDecision — the forced password change", () => {
  it("refuses a user who has not yet chosen their own password", () => {
    const decision = apiAuthDecision(sessionUser({ mustChangePassword: true }));
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(decision.status).toBe(403);
  });

  it("lets that same user through to the endpoint that clears the flag", () => {
    const decision = apiAuthDecision(sessionUser({ mustChangePassword: true }), {
      allowPasswordChangePending: true,
    });
    expect(decision.ok).toBe(true);
  });

  it("admits a user who has already chosen a password", () => {
    const decision = apiAuthDecision(sessionUser({ mustChangePassword: false }));
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.user.actorProfileId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("gates staff and admins the same way, not students only", () => {
    for (const role of ["STAFF", "ADMIN", "SUPER_ADMIN"] as const) {
      const decision = apiAuthDecision(sessionUser({ role, mustChangePassword: true }));
      expect(decision.ok, `${role} must be gated`).toBe(false);
    }
  });
});

describe("apiAuthDecision — what it hands back", () => {
  it("returns the session user unchanged, so callers build TenantContext from it", () => {
    const user = sessionUser();
    const decision = apiAuthDecision(user);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.user).toBe(user);
    expect(decision.user.tenantId).toBe("11111111-1111-1111-1111-111111111111");
    expect(decision.user.timezone).toBe("Asia/Kolkata");
  });
});
