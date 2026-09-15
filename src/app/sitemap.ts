import type { MetadataRoute } from "next";
import { LEGAL_PAGES, resolveSiteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = resolveSiteUrl({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  });
  return [
    { url: new URL("/", base).href, changeFrequency: "monthly", priority: 1 },
    { url: new URL("/login", base).href, changeFrequency: "yearly", priority: 0.3 },
    ...LEGAL_PAGES.map((page) => ({
      url: new URL(page.href, base).href,
      changeFrequency: "yearly" as const,
      priority: 0.2,
    })),
  ];
}
