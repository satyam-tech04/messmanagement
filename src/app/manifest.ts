import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/app-info";
import { SITE_DESCRIPTION } from "@/lib/site";

/**
 * Web app manifest — the name, colours and logo a phone uses when the site is
 * added to the home screen, and that some link unfurlers read for the icon.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} — Hostel mess management`,
    short_name: APP_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#05070a",
    theme_color: "#05070a",
    categories: ["food", "education", "productivity"],
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
