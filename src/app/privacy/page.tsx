import { permanentRedirect } from "next/navigation";

/**
 * The privacy policy lives on the public legal site, not in this app.
 *
 * Both app stores need one URL that never requires sign-in, and a policy kept
 * in two places drifts — the store data-safety answers must agree with exactly
 * one document. That document is `site/privacy/index.html`, published to GitHub
 * Pages by `npm run site:publish`. This route stays (and stays in proxy.ts's
 * PUBLIC_PATHS) so links already pointing here keep working.
 */
export default function PrivacyPage() {
  permanentRedirect("https://satyam-tech04.github.io/messmanagement/privacy/");
}
