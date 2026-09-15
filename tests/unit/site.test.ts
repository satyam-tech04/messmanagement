/**
 * Where the site says it lives, for link previews.
 *
 * WhatsApp, Slack and X only fetch a share image from an **absolute** URL. If
 * the canonical origin resolves to localhost in production — which is what the
 * env default is — every shared link previews as a bare URL with no poster and
 * no logo, and nothing in the app itself looks wrong.
 */
import { describe, expect, it } from "vitest";
import { isPublicMetadataPath, resolveSiteUrl } from "@/lib/site";

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
