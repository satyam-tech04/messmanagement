"use server";

/**
 * Changing what every installed app does, without shipping anything (D-35).
 *
 * The most powerful screen in the product: one save reaches every phone at next
 * launch. Two consequences shape this file.
 *
 * **SUPER_ADMIN only.** A mess admin runs one hostel; these are decisions about
 * our app across every hostel. The operator layout already 404s anyone else,
 * and this checks again rather than trusting the route (rule 8).
 *
 * **Audited without exception.** "Why did ads appear on the meal-code screen on
 * Tuesday?" and "who locked out every build below 14?" both have to be
 * answerable, and the row itself only remembers the latest state.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AD_PLACEMENTS } from "@/core/policies/app-config.policy";
import { getSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";
import { readPlatformConfigRow } from "@/infra/queries/platform-config";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";

export interface AppConfigState {
  readonly error?: string;
  readonly success?: string;
}

/** Empty string means "cleared", which is different from "unchanged". */
const unitId = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .refine(
    (value) => value === null || /^ca-app-pub-\d+\/\d+$/.test(value),
    // Named precisely, because the mistake it catches is invisible otherwise:
    // an app id here produces no ads, no error and nothing in any log.
    "That is not an ad unit id. It must look like ca-app-pub-0000000000000000/0000000000 — note the slash; a tilde means you have pasted the app id.",
  );

const schema = z.object({
  adsEnabled: z.boolean(),
  adsTestMode: z.boolean(),
  placements: z.array(z.enum(AD_PLACEMENTS)),
  unitAndroid: unitId,
  unitIos: unitId,
  minAppBuild: z.coerce.number().int().min(0).max(1_000_000),
});

export async function updateAppConfig(
  _prev: AppConfigState,
  formData: FormData,
): Promise<AppConfigState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  if (user.role !== "SUPER_ADMIN") return { error: "Only the platform operator can change this." };

  const parsed = schema.safeParse({
    adsEnabled: formData.get("adsEnabled") === "on",
    adsTestMode: formData.get("adsTestMode") === "on",
    placements: formData.getAll("placements").map(String),
    unitAndroid: formData.get("unitAndroid") ?? "",
    unitIos: formData.get("unitIos") ?? "",
    minAppBuild: formData.get("minAppBuild") ?? 0,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Those settings could not be read." };
  }

  const admin = createAdminClient();
  const before = await readPlatformConfigRow(admin);

  // Stored as an object keyed by screen, so a screen added later needs no
  // migration — the policy narrows whatever is here to the screens that exist.
  const placements = Object.fromEntries(
    AD_PLACEMENTS.map((screen) => [screen, parsed.data.placements.includes(screen)]),
  );

  const { error } = await admin
    .from("platform_config")
    .update({
      ads_enabled: parsed.data.adsEnabled,
      ads_test_mode: parsed.data.adsTestMode,
      ads_placements: placements,
      ads_unit_android: parsed.data.unitAndroid,
      ads_unit_ios: parsed.data.unitIos,
      min_app_build: parsed.data.minAppBuild,
      updated_by: user.actorProfileId,
    })
    .eq("id", 1);

  if (error) return { error: `Could not save: ${error.message}` };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: "PLATFORM_CONFIG_UPDATED",
    entityType: "platform_config",
    entityId: null,
    before: before
      ? {
          adsEnabled: before.adsEnabled,
          adsTestMode: before.adsTestMode,
          placements: JSON.stringify(before.placements),
          minAppBuild: before.minAppBuild,
        }
      : null,
    after: {
      adsEnabled: parsed.data.adsEnabled,
      adsTestMode: parsed.data.adsTestMode,
      placements: JSON.stringify(placements),
      minAppBuild: parsed.data.minAppBuild,
    },
  });

  revalidatePath("/superuser/app-config");

  const live = parsed.data.adsEnabled && !parsed.data.adsTestMode;
  return {
    success: live
      ? "Saved. Live ads are on — every app picks this up at its next launch."
      : "Saved. Apps pick this up at their next launch.",
  };
}
