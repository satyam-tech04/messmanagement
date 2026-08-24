"use server";

/**
 * Moving the platform operator between messes.
 *
 * The Server Action does what rule 2 allows and nothing more: validate, build
 * the context, call one use case, map the result. The decision about who may
 * cross a tenant boundary lives in `tenant-switch.policy.ts`; the crossing
 * itself lives in `switch-tenant.ts`.
 *
 * The one thing that is genuinely this layer's job is the token. Repointing the
 * profile changes what the *database* believes, but the operator is still
 * holding a JWT stamped with the old `tenant_id` claim, and every RLS policy
 * reads the claim. Until it is re-issued they are in the contradictory state of
 * querying one mess while the database authorises another — which fails closed
 * (empty screens), but is confusing rather than correct. `refreshSession()` runs
 * the auth hook again and re-stamps the claim; it is not optional cleanup.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { switchOperatorTenant } from "@/core/services/switch-tenant";
import { getSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseAuditLogRepository, SupabaseTenantDirectory } from "@/infra/supabase/repositories";

export interface SwitchMessState {
  readonly error?: string;
}

const schema = z.object({ tenantId: z.string().uuid("Choose a mess from the list.") });

export async function switchMess(
  _prev: SwitchMessState,
  formData: FormData,
): Promise<SwitchMessState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };

  const parsed = schema.safeParse({ tenantId: formData.get("tenantId") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Choose a mess." };

  const supabase = await createClient();
  const admin = createAdminClient();

  const result = await switchOperatorTenant(user, parsed.data.tenantId, {
    directory: new SupabaseTenantDirectory(supabase, admin),
  });

  if (!result.ok) return { error: result.error.message };

  // Nothing moved, so there is nothing to re-issue or record.
  if (result.value.alreadyActive) return {};

  // Recorded in the mess being entered, not the one being left. The question
  // this trail has to answer is "who was in our data on Tuesday?", and the
  // person asking it is the admin of the mess that was entered.
  const requestHeaders = await headers();
  await new SupabaseAuditLogRepository(admin).write({
    tenantId: result.value.tenant.id,
    actorProfileId: user.actorProfileId,
    action: "TENANT_SWITCH",
    entityType: "tenant",
    entityId: result.value.tenant.id,
    before: { tenantSlug: user.tenantSlug },
    after: { tenantSlug: result.value.tenant.slug },
    ip: requestHeaders.get("x-forwarded-for"),
    userAgent: requestHeaders.get("user-agent"),
  });

  // Re-stamps tenant_id and user_role by running the auth hook again. Must come
  // after the move, or it re-issues the claim the operator already had.
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    // The profile has moved but the token has not. Say so plainly rather than
    // showing a success and leaving them staring at an empty mess.
    return {
      error: "Moved, but your session did not update. Sign out and back in to finish.",
    };
  }

  // The shell caches the mess name, and every admin page below it is now
  // showing another hostel's data.
  revalidatePath("/", "layout");
  redirect("/admin");
}
