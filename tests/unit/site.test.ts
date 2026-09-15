/**
 * Where the site says it lives, for link previews.
 *
 * WhatsApp, Slack and X only fetch a share image from an **absolute** URL. If
 * the canonical origin resolves to localhost in production — which is what the
 * env default is — every shared link previews as a bare URL with no poster and
 * no logo, and nothing in the app itself looks wrong.
 */
import { describe, expect, it } from "vitest";
import { LEGAL_PAGES, isPublicMetadataPath, isPublicPagePath, resolveSiteUrl } from "@/lib/site";

describe("resolveSiteUrl", () => {
  it("uses an explicitly configured public URL", () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_APP_URL: "https://mealadda.app",
        VERCEL_PROJECT_PRODUCTION_URL: "messmanagement-lime.vercel.app",
      }).href,
    ).toBe("https://mealadda.app/");
  });

  it("ignores a localhost app URL when Vercel knows the production domain", () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        VERCEL_PROJECT_PRODUCTION_URL: "messmanagement-lime.vercel.app",
      }).href,
    ).toBe("https://messmanagement-lime.vercel.app/");
  });

  it("uses the Vercel production domain when no app URL is set", () => {
    expect(
      resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "messmanagement-lime.vercel.app" }).href,
    ).toBe("https://messmanagement-lime.vercel.app/");
  });

  it("falls back to localhost for local development", () => {
    expect(resolveSiteUrl({}).href).toBe("http://localhost:3000/");
    expect(resolveSiteUrl({ NEXT_PUBLIC_APP_URL: "http://localhost:4499" }).href).toBe(
      "http://localhost:4499/",
    );
  });

  it("skips a malformed value instead of crashing the whole site's metadata", () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_APP_URL: "not a url",
        VERCEL_PROJECT_PRODUCTION_URL: "messmanagement-lime.vercel.app",
      }).href,
    ).toBe("https://messmanagement-lime.vercel.app/");
    expect(resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "bad host name" }).href).toBe(
      "http://localhost:3000/",
    );
  });
});

describe("isPublicMetadataPath", () => {
  it("lets crawlers fetch the share image, icons, manifest and robots without signing in", () => {
    // The proxy redirects anonymous requests to /login. A crawler that is
    // redirected gets HTML where it wanted a PNG, and shows no preview.
    for (const path of [
      "/opengraph-image",
      "/twitter-image",
      "/opengraph-image-12ab34",
      "/manifest.webmanifest",
      "/robots.txt",
      "/sitemap.xml",
    ]) {
      expect(isPublicMetadataPath(path)).toBe(true);
    }
  });

  it("does not open anything else", () => {
    for (const path of ["/admin", "/opengraph", "/student/opengraph-image", "/robots", "/api/me"]) {
      expect(isPublicMetadataPath(path)).toBe(false);
    }
  });
});

describe("isPublicPagePath", () => {
  it("serves every legal page to someone who is not signed in", () => {
    // Both app stores open these URLs before the app, with no account. A
    // redirect to /login here is a rejection, and Play's account-deletion URL
    // must work for someone who can no longer sign in at all.
    for (const page of LEGAL_PAGES) {
      expect(isPublicPagePath(page.href)).toBe(true);
    }
    expect(LEGAL_PAGES.map((p) => p.href)).toEqual([
      "/privacy",
      "/terms",
      "/delete-account",
      "/support",
    ]);
  });

  it("keeps sign-in reachable, with and without a trailing path", () => {
    expect(isPublicPagePath("/login")).toBe(true);
    expect(isPublicPagePath("/auth/callback")).toBe(true);
    expect(isPublicPagePath("/privacy/")).toBe(true);
  });

  it("does not treat a name that merely starts the same as public", () => {
    for (const path of ["/privacy-export", "/terms2", "/supporters", "/login-as"]) {
      expect(isPublicPagePath(path)).toBe(false);
    }
  });

  it("never opens a role shell or the API", () => {
    for (const path of [
      "/admin",
      "/staff",
      "/student",
      "/superuser",
      "/change-password",
      "/api/me",
    ]) {
      expect(isPublicPagePath(path)).toBe(false);
    }
  });
});
