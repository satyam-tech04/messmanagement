/**
 * What the app needs to know before anyone signs in (D-33).
 *
 * The one endpoint that has to exist **before** the first release: it is what
 * lets a future API change be shipped at all. Without it, every copy already on
 * a student's phone keeps calling whatever it was built against, and there is
 * no way to require an upgrade — the app would simply start failing in ways
 * nobody could explain, three times a day, at a counter.
 *
 * Deliberately public and unauthenticated. A blocked-out app cannot sign in to
 * be told that it is blocked.
 *
 * `updateUrl` is served rather than compiled in for the same reason: the store
 * listings do not exist yet, and when they do, pointing at them must not need
 * the very update it is asking for.
 */
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { WEBSITE } from "@/lib/app-info";

export async function GET() {
  return NextResponse.json(
    {
      minimumBuild: serverEnv.MIN_APP_BUILD,
      updateUrl: WEBSITE,
      message: "Update the app to carry on. This version can no longer reach the mess.",
    },
    {
      // Never cached. The point of this endpoint is to change the answer in a
      // hurry, and a cached "you are fine" would outlive the emergency.
      headers: { "Cache-Control": "no-store" },
    },
  );
}
