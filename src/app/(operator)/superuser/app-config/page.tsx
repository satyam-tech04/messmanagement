import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parsePlacements } from "@/core/policies/app-config.policy";
import { requireSessionUser } from "@/infra/auth/session";
import { readPlatformConfigRow } from "@/infra/queries/platform-config";
import { createAdminClient } from "@/infra/supabase/admin";
import { APP_BUILD, pageTitle } from "@/lib/app-info";
import { ConfigForm } from "./config-form";

export const metadata: Metadata = { title: pageTitle("App configuration") };

/**
 * What the app does, decided here rather than in a release (D-35).
 *
 * The operator layout 404s anyone who is not SUPER_ADMIN, so there is no second
 * guard on the page itself — the Server Action checks again where it matters.
 */
export default async function AppConfigPage() {
  const user = await requireSessionUser();
  const row = await readPlatformConfigRow(createAdminClient());
  const placements = parsePlacements(row?.placements);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div className="space-y-2">
        <Button
          variant="ghost"
          size="sm"
          render={
            <Link href="/superuser">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back
            </Link>
          }
        />
        <h1 className="text-2xl font-semibold">App configuration</h1>
        <p className="text-muted-foreground text-sm">
          Read by every installed app at launch. Changes here need no store release — that is the
          point of them — but they reach every student on the platform, not one mess.
        </p>
        {row?.updatedAt ? (
          <p className="text-muted-foreground text-xs">
            Last changed{" "}
            {new Date(row.updatedAt).toLocaleString("en-IN", {
              // The operator's own mess time, never the browser's (rule 9).
              timeZone: user.timezone,
              dateStyle: "medium",
              timeStyle: "short",
            })}
            .
          </p>
        ) : null}
      </div>

      <ConfigForm
        values={{
          adsEnabled: row?.adsEnabled ?? false,
          adsTestMode: row?.adsTestMode ?? true,
          placements,
          unitAndroid: row?.unitAndroid ?? "",
          unitIos: row?.unitIos ?? "",
          minAppBuild: row?.minAppBuild ?? 0,
          currentBuild: APP_BUILD,
        }}
      />
    </div>
  );
}
