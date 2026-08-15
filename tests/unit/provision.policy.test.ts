/**
 * Tests for provisioning a new mess.
 *
 * This runs against production, by hand, to onboard a paying customer. It gets
 * one attempt: a mess created with a bad slug cannot be renamed without
 * breaking every student's login, because the synthetic email each student
 * authenticates with is derived from it.
 *
 * That is the rule worth stating plainly — `tenants_slug_format` is
 * `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`, and validating it here rather than
 * letting Postgres reject it means the operator gets a sentence explaining what
 * to type instead of a constraint violation.
 */
import { describe, expect, it } from "vitest";
import { parseMessProvision } from "@/core/policies/provision.policy";

const valid = {
  name: "Sunrise Hostel Mess",
  slug: "sunrise-mess",
  adminEmail: "owner@example.com",
};

describe("parseMessProvision — the slug becomes every student's login", () => {
  it("accepts a normal hyphenated slug", () => {
    const r = parseMessProvision(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.slug).toBe("sunrise-mess");
  });

  it("lower-cases what was typed rather than rejecting it", () => {
    // The constraint is lower-case only, and an operator typing a proper noun
    // should not be told off for it.
    const r = parseMessProvision({ ...valid, slug: "Sunrise-Mess" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.slug).toBe("sunrise-mess");
  });

  it("trims surrounding whitespace", () => {
    const r = parseMessProvision({ ...valid, slug: "  sunrise-mess  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.slug).toBe("sunrise-mess");
  });

  it("rejects an underscore, which the database refuses", () => {
    // Learned once already: the demo tenant is `unversity-mess` precisely
    // because `unversity_mess` fails this constraint.
    const r = parseMessProvision({ ...valid, slug: "sunrise_mess" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/letters, digits/i);
  });

  it("rejects spaces", () => {
    expect(parseMessProvision({ ...valid, slug: "sunrise mess" }).ok).toBe(false);
  });

  it("rejects a leading or trailing hyphen", () => {
    expect(parseMessProvision({ ...valid, slug: "-sunrise" }).ok).toBe(false);
    expect(parseMessProvision({ ...valid, slug: "sunrise-" }).ok).toBe(false);
  });

  it("rejects one too short to satisfy the constraint", () => {
    // `[a-z0-9][a-z0-9-]{1,38}[a-z0-9]` is three characters minimum, not two.
    expect(parseMessProvision({ ...valid, slug: "abc" }).ok).toBe(true);
    expect(parseMessProvision({ ...valid, slug: "ab" }).ok).toBe(false);
    expect(parseMessProvision({ ...valid, slug: "a" }).ok).toBe(false);
  });

  it("rejects one longer than the column allows", () => {
    expect(parseMessProvision({ ...valid, slug: "a".repeat(41) }).ok).toBe(false);
  });

  it("produces a slug the database constraint accepts", () => {
    // Mirrored here so the two cannot drift apart.
    const constraint = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
    for (const input of ["sunrise-mess", "Sunrise-Mess", "  hostel-9  ", "a1b"]) {
      const r = parseMessProvision({ ...valid, slug: input });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.slug).toMatch(constraint);
    }
  });
});

describe("parseMessProvision — name and email", () => {
  it("keeps the display name exactly as typed, including punctuation", () => {
    // The slug is constrained; the name is what students see and may contain
    // anything. `unversity_mess` is a real display name in this system.
    const r = parseMessProvision({ ...valid, name: "St. Xavier's Mess & Canteen" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe("St. Xavier's Mess & Canteen");
  });

  it("trims the name", () => {
    const r = parseMessProvision({ ...valid, name: "  Sunrise  " });
    if (r.ok) expect(r.value.name).toBe("Sunrise");
  });

  it("rejects an empty name", () => {
    expect(parseMessProvision({ ...valid, name: "   " }).ok).toBe(false);
  });

  it("rejects a malformed admin email", () => {
    const r = parseMessProvision({ ...valid, adminEmail: "not-an-email" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/email/i);
  });

  it("lower-cases the admin email, since that is how they will sign in", () => {
    const r = parseMessProvision({ ...valid, adminEmail: "Owner@Example.COM" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.adminEmail).toBe("owner@example.com");
  });

  it("refuses a synthetic student address as the admin login", () => {
    // `.invalid` addresses are generated for students and can never receive
    // mail. An admin who cannot be emailed cannot recover their account.
    const r = parseMessProvision({ ...valid, adminEmail: "cs21b001@sunrise-mess.mess.invalid" });
    expect(r.ok).toBe(false);
  });
});

describe("parseMessProvision — the timezone", () => {
  it("is Asia/Kolkata for now, and stated rather than assumed", () => {
    const r = parseMessProvision(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.timezone).toBe("Asia/Kolkata");
  });
});
