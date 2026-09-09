/**
 * Reading the access token out of an `Authorization` header.
 *
 * This is the mobile app's entire identity on every request, so the parser has
 * to be strict about what it accepts. A permissive one that returned `""` or a
 * stray scheme name would hand a meaningless string to `getClaims()`, and a
 * verification failure there is indistinguishable from a tampered token — the
 * request would be refused either way, but the reason would be a parsing bug
 * nobody could see. Reject early and return null instead.
 */
import { describe, expect, it } from "vitest";
import { parseBearerToken } from "@/lib/bearer-token";

describe("parseBearerToken — what counts as a token", () => {
  it("reads the token from a well-formed header", () => {
    expect(parseBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("accepts the scheme in any case, as HTTP says it is case-insensitive", () => {
    expect(parseBearerToken("bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(parseBearerToken("BEARER abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("tolerates extra whitespace between the scheme and the token", () => {
    expect(parseBearerToken("Bearer    abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("trims trailing whitespace rather than signing it into the token", () => {
    expect(parseBearerToken("Bearer abc.def.ghi  ")).toBe("abc.def.ghi");
  });
});

describe("parseBearerToken — what it refuses", () => {
  it("returns null when the header is absent", () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
  });

  it("returns null for an empty or whitespace-only header", () => {
    expect(parseBearerToken("")).toBeNull();
    expect(parseBearerToken("   ")).toBeNull();
  });

  it("returns null for a scheme with no token, rather than an empty string", () => {
    expect(parseBearerToken("Bearer")).toBeNull();
    expect(parseBearerToken("Bearer ")).toBeNull();
  });

  it("refuses other authentication schemes", () => {
    expect(parseBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(parseBearerToken("Digest abc")).toBeNull();
  });

  it("refuses a bare token with no scheme, which is not what the header means", () => {
    expect(parseBearerToken("abc.def.ghi")).toBeNull();
  });

  it("refuses a token containing whitespace, which is never a valid JWT", () => {
    expect(parseBearerToken("Bearer abc def")).toBeNull();
  });
});
