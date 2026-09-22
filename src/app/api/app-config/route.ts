/**
 * Everything the app needs to know before it draws anything (D-35).
 *
 * One request at launch, answering two questions that used to be compiled in:
 * *am I still allowed to run* (D-33) and *do I show ads, where, and with which
 * unit*. Changing either is then a toggle an operator flips, not a release
 * every student has to install.
 *
 * **Public and unauthenticated**, like `/api/app-version`: a blocked-out app
 * cannot sign in to be told it is blocked, and the ad configuration is in the
 * binary's behaviour anyway — there is nothing here a student could not see by
 * opening the app.
 *
 * The platform comes from a query parameter and decides only *which of our own
 * ad units* is returned. There is nothing to escalate: both are ours, and an
 * unrecognised value falls back to Android rather than failing the launch.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { defaultAppConfig, type DevicePlatform } from "@/core/policies/app-config.policy";
import { readAppConfig } from "@/infra/queries/platform-config";
import { createAdminClient } from "@/infra/supabase/admin";
import { serverEnv } from "@/lib/env.server";
import { APP_NAME, WEBSITE } from "@/lib/app-info";

const platformSchema = z.enum(["ANDROID", "IOS"]).catch("ANDROID");

export async function GET(request: Request) {
  const url = new URL(request.url);
  const platform: DevicePlatform = platformSchema.parse(
    (url.searchParams.get("platform") ?? "").toUpperCase(),
  );

  let config;
  try {
    config = await readAppConfig(createAdminClient(), platform, serverEnv.MIN_APP_BUILD);
  } catch {
    // A database that cannot be reached must not stop the app starting. The
    // defaults block nobody and show no ads.
    config = { ...defaultAppConfig(), minimumBuild: 0 };
  }

  return NextResponse.json(
    {
      minimumBuild: config.minimumBuild,
      updateUrl: WEBSITE,
      updateMessage: `Update ${APP_NAME} to carry on. This version can no longer reach the mess.`,
      ads: config.ads,
      flags: config.flags,
    },
    {
      // Never cached. The entire value of this endpoint is that the answer can
      // change in a hurry, and a cached "ads on" would outlive the switch-off.
      headers: { "Cache-Control": "no-store" },
    },
  );
}
