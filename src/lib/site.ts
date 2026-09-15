/**
 * The public face of the site: where it lives and what a shared link says.
 *
 * One place for the title, description and origin so the page `<head>`, the
 * share poster and the web manifest can never describe MealAdda three different
 * ways.
 */
import { z } from "zod";
import { APP_NAME } from "@/lib/app-info";

export const SITE_TAGLINE = "Hostel mess management";

export const SITE_TITLE = `${APP_NAME} — ${SITE_TAGLINE}, from menu to plate`;

export const SITE_DESCRIPTION =
  "MealAdda runs your hostel mess: weekly menus, meal plans, a QR meal pass for every student and a live count so the kitchen cooks for who's actually eating.";

export const SITE_KEYWORDS = [
  "hostel mess management",
  "mess management system",
  "mess software",
  "hostel food",
  "meal plan",
  "QR meal attendance",
  "canteen management",
  "PG mess",
  APP_NAME,
];

const urlSchema = z.url();

/**
 * The absolute origin link previews are built from.
 *
 * Share images must be absolute URLs, and the env default for
 * `NEXT_PUBLIC_APP_URL` is localhost — so a deployment that never set it would
 * advertise `http://localhost:3000/opengraph-image` to WhatsApp. A localhost
 * value is therefore only trusted when nothing better exists, and Vercel's own
 * production domain is the next choice. Malformed values are skipped, never
 * thrown: bad metadata must not take the landing page down.
 */
export function resolveSiteUrl(env: {
  readonly NEXT_PUBLIC_APP_URL?: string | undefined;
  readonly VERCEL_PROJECT_PRODUCTION_URL?: string | undefined;
}): URL {
  const explicit = urlSchema.safeParse(env.NEXT_PUBLIC_APP_URL);
  const explicitUrl = explicit.success ? new URL(explicit.data) : null;
  if (explicitUrl && !isLocal(explicitUrl)) return explicitUrl;

  const host = env.VERCEL_PROJECT_PRODUCTION_URL;
  if (host) {
    const vercel = urlSchema.safeParse(`https://${host}`);
    if (vercel.success && !/\s/.test(host)) return new URL(vercel.data);
  }

  return explicitUrl ?? new URL("http://localhost:3000");
}

function isLocal(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

/**
 * Metadata files that crawlers fetch anonymously. Exact names at the root only
 * (with Next's optional generated suffix on the images) — a prefix match here
 * would be a hole in route gating.
 */
const PUBLIC_METADATA =
  /^\/(?:(?:opengraph-image|twitter-image)(?:-[\w]+)?|manifest\.webmanifest|robots\.txt|sitemap\.xml)$/;

export function isPublicMetadataPath(pathname: string): boolean {
  return PUBLIC_METADATA.test(pathname);
}
