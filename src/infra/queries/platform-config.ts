/**
 * The one row of runtime configuration (D-35).
 *
 * Read on the service role: the table has RLS on with no policies, because
 * nothing should reach it except this reader and the superuser's Server Action.
 * What the app receives is a filtered view built by the policy — the row itself
 * carries both platforms' ad units, and a client has no business seeing the
 * other one.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adsFor,
  defaultAppConfig,
  resolveMinimumBuild,
  type AppConfig,
  type DevicePlatform,
} from "@/core/policies/app-config.policy";
import type { Database } from "@/infra/supabase/database.types";

export interface PlatformConfigRow {
  readonly adsEnabled: boolean;
  readonly adsTestMode: boolean;
  readonly placements: unknown;
  readonly unitAndroid: string | null;
  readonly unitIos: string | null;
  readonly minAppBuild: number | null;
  readonly flags: Record<string, unknown>;
  readonly updatedAt: string | null;
}

export async function readPlatformConfigRow(
  admin: SupabaseClient<Database>,
): Promise<PlatformConfigRow | null> {
  const { data, error } = await admin
    .from("platform_config")
    .select(
      "ads_enabled, ads_test_mode, ads_placements, ads_unit_android, ads_unit_ios, min_app_build, flags, updated_at",
    )
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    adsEnabled: data.ads_enabled,
    adsTestMode: data.ads_test_mode,
    placements: data.ads_placements,
    unitAndroid: data.ads_unit_android,
    unitIos: data.ads_unit_ios,
    minAppBuild: data.min_app_build,
    flags: (data.flags ?? {}) as Record<string, unknown>,
    updatedAt: data.updated_at,
  };
}

/**
 * What one device should be told.
 *
 * An unreachable row is not an error the app has to handle — it gets the safe
 * defaults, which are "no ads, nobody blocked". The alternative, failing the
 * request, would turn a database hiccup into an app that will not start.
 */
export async function readAppConfig(
  admin: SupabaseClient<Database>,
  platform: DevicePlatform,
  envMinBuild: number,
): Promise<AppConfig> {
  const row = await readPlatformConfigRow(admin);
  if (!row) return { ...defaultAppConfig(), minimumBuild: envMinBuild };

  return {
    minimumBuild: resolveMinimumBuild({ stored: row.minAppBuild, envFallback: envMinBuild }),
    ads: adsFor(
      {
        adsEnabled: row.adsEnabled,
        adsTestMode: row.adsTestMode,
        placements: row.placements,
        unitAndroid: row.unitAndroid,
        unitIos: row.unitIos,
      },
      platform,
    ),
    flags: row.flags,
  };
}
