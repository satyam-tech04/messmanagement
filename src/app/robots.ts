import type { MetadataRoute } from "next";
import { resolveSiteUrl } from "@/lib/site";

/**
 * Index the landing page; keep every signed-in surface out of search results.
 * (Those routes require a session anyway — this only stops crawlers wasting
 * requests on redirects to /login.)
 */
export default function robots(): MetadataRoute.Robots {
  const base = resolveSiteUrl({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  });
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login"],
        disallow: ["/admin", "/staff", "/student", "/superuser", "/change-password", "/api"],
      },
    ],
    sitemap: new URL("/sitemap.xml", base).href,
  };
}
