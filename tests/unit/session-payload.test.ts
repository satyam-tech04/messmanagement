/**
 * What the mobile client is told about its own session.
 *
 * `SessionUser` carries internal identifiers the server derives for itself —
 * `tenantId` and `actorProfileId`. The app never needs either: every endpoint
 * builds its own `TenantContext` from the token, and a `tenantId` arriving in a
 * request body is "an attacker's suggestion, not a fact" (tenant-context.ts).
 *
 * So they are deliberately not serialised. Shipping them would put a real
 * tenant UUID into a binary that anyone can unpack, and — worse — invite a
 * future endpoint to start accepting one back, which is exactly the shape of
 * the multi-tenancy bug rule 8 exists to prevent.
 *
 * The assertions below are therefore about what is *absent* as much as what is
 * present.
 */
import { describe, expect, it } from "vitest";
import { toSessionPayload } from "@/infra/http/session-payload";
import type { SessionUser } from "@/infra/auth/session";

function sessionUser(over: Partial<SessionUser> = {}): SessionUser {
  return {
    tenantId: "11111111-1111-1111-1111-111111111111",
    tenantSlug: "campus-crave",
    tenantName: "Campus Crave",
    tenantLogoPath: null,
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

describe("toSessionPayload — what the app is given", () => {
  it("carries what a screen needs to render", () => {
    const payload = toSessionPayload(sessionUser());
    expect(payload.role).toBe("STUDENT");
    expect(payload.fullName).toBe("Asha Rao");
    expect(payload.tenantSlug).toBe("campus-crave");
    expect(payload.mustChangePassword).toBe(false);
  });

  it("carries the mess's own name, which the app shows in place of ours", () => {
    // Once signed in, a member is inside their hostel's app. Our mark stays on
    // the store listing and the login screen.
    expect(toSessionPayload(sessionUser()).tenantName).toBe("Campus Crave");
  });

  it("gives a route for the logo, never the storage path", () => {
    // The bucket is private, and the client must not learn its layout.
    const withLogo = toSessionPayload(
      sessionUser({ tenantLogoPath: "11111111-1111-1111-1111-111111111111/logo" }),
    );
    expect(withLogo.tenantLogoUrl).toBe("/api/tenant/logo");
    // The storage path embeds the tenant id, so serialising it would leak the
    // very identifier the rest of this file exists to keep out.
    expect(JSON.stringify(withLogo)).not.toContain("11111111-1111-1111-1111-111111111111");
  });

  it("says null when the mess has not uploaded one, so the app shows its name", () => {
    expect(toSessionPayload(sessionUser()).tenantLogoUrl).toBeNull();
  });

  it("carries the tenant's timezone, so the app never formats in the device's", () => {
    // A student travelling, or a phone with the wrong zone set, must still see
    // the mess's own service dates. Rule 9.
    expect(toSessionPayload(sessionUser()).timezone).toBe("Asia/Kolkata");
  });

  it("says whether this is a student, without exposing the student id", () => {
    expect(toSessionPayload(sessionUser()).isStudent).toBe(true);
    expect(toSessionPayload(sessionUser({ role: "STAFF", studentId: undefined })).isStudent).toBe(
      false,
    );
  });

  it("reports the forced password change, which gates the whole app", () => {
    expect(toSessionPayload(sessionUser({ mustChangePassword: true })).mustChangePassword).toBe(
      true,
    );
  });
});

describe("toSessionPayload — what it must never leak", () => {
  it("omits tenantId and actorProfileId", () => {
    const payload = toSessionPayload(sessionUser()) as unknown as Record<string, unknown>;
    expect(payload).not.toHaveProperty("tenantId");
    expect(payload).not.toHaveProperty("actorProfileId");
  });

  it("omits studentId, which the server derives from the token instead", () => {
    const payload = toSessionPayload(sessionUser()) as unknown as Record<string, unknown>;
    expect(payload).not.toHaveProperty("studentId");
  });

  it("serialises no identifier resembling a UUID at all", () => {
    // A blunt guard against a future field being added without thinking about
    // it: no value in this payload should look like an internal primary key.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const value of Object.values(toSessionPayload(sessionUser()))) {
      expect(typeof value === "string" && uuid.test(value)).toBe(false);
    }
  });
});
