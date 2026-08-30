"use server";

/**
 * Special-meal announcements.
 *
 * Admin-only, and deliberately tiny: an announcement changes nothing
 * operational. It cannot affect eligibility, attendance, the headcount, a plan
 * or a price — see D-19 and §11 of the spec. If you find yourself reaching for
 * any of those tables from this file, the feature has drifted.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ALL_MEAL_SLOTS, type MealSlot } from "@/core/domain/enums";
import { parseAnnouncementDraft } from "@/core/policies/announcement.policy";
import { toServiceDate } from "@/core/time";
import { createAdminClient } from "@/infra/supabase/admin";
import { getSessionUser } from "@/infra/auth/session";
import { SupabaseAuditLogRepository } from "@/infra/supabase/repositories";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";
import { createClient } from "@/infra/supabase/server";

export interface AnnouncementActionState {
  readonly error?: string;
  readonly success?: string;
}

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.");

const schema = z.object({
  title: z.string(),
  body: z.string(),
  startsOn: dateField,
  endsOn: dateField,
  serviceDate: dateField.optional().or(z.literal("")),
  mealSlot: z
    .enum(ALL_MEAL_SLOTS as unknown as [MealSlot, ...MealSlot[]])
    .optional()
    .or(z.literal("")),
});

async function requireAdminWithFeature() {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." as const };
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return { error: "Only an admin can post announcements." as const };
  }

  // The toggle is a permission, not a display preference: a hidden screen is
  // not a closed door, so the action refuses a request that arrives anyway.
  const settings = await new SupabaseTenantRepository(
    await createClient(),
    createAdminClient(),
  ).getSettings(user.tenantId);
  if (!settings?.allowAnnouncements) {
    return { error: "Announcements are switched off for this mess." as const };
  }

  return { user, admin: createAdminClient() };
}

export async function saveAnnouncement(
  announcementId: string | null,
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const auth = await requireAdminWithFeature();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const parsed = schema.safeParse({
    title: formData.get("title") ?? "",
    body: formData.get("body") ?? "",
    startsOn: formData.get("startsOn") ?? "",
    endsOn: formData.get("endsOn") ?? "",
    serviceDate: formData.get("serviceDate") ?? "",
    mealSlot: formData.get("mealSlot") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const draft = parseAnnouncementDraft({
    actorRole: user.role,
    title: parsed.data.title,
    body: parsed.data.body,
    startsOn: toServiceDate(parsed.data.startsOn),
    endsOn: toServiceDate(parsed.data.endsOn),
    ...(parsed.data.serviceDate ? { serviceDate: toServiceDate(parsed.data.serviceDate) } : {}),
    ...(parsed.data.mealSlot ? { mealSlot: parsed.data.mealSlot as MealSlot } : {}),
  });
  if (!draft.ok) return { error: draft.error.message };

  const row = {
    tenant_id: user.tenantId,
    title: draft.value.title,
    body: draft.value.body,
    service_date: draft.value.serviceDate,
    meal_slot: draft.value.mealSlot,
    starts_on: draft.value.startsOn,
    ends_on: draft.value.endsOn,
  };

  const written = announcementId
    ? await admin
        .from("announcements")
        .update(row)
        .eq("id", announcementId)
        .eq("tenant_id", user.tenantId)
        .select("id")
        .single()
    : await admin
        .from("announcements")
        .insert({ ...row, status: "PUBLISHED", created_by: user.actorProfileId })
        .select("id")
        .single();

  if (written.error) return { error: `Could not save: ${written.error.message}` };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: announcementId ? "ANNOUNCEMENT_UPDATED" : "ANNOUNCEMENT_CREATED",
    entityType: "announcement",
    entityId: written.data.id,
    after: {
      title: draft.value.title,
      startsOn: draft.value.startsOn,
      endsOn: draft.value.endsOn,
    },
  });

  revalidatePath("/admin/announcements");
  revalidatePath("/student");
  return { success: announcementId ? "Announcement updated." : "Announcement posted." };
}

/**
 * Withdraws or restores an announcement.
 *
 * Archived rather than deleted (B8), so a mess can see what it announced last
 * month. An archived one vanishes from student screens immediately, whatever
 * its dates say.
 */
export async function setAnnouncementArchived(
  announcementId: string,
  archived: boolean,
): Promise<AnnouncementActionState> {
  const auth = await requireAdminWithFeature();
  if ("error" in auth) return { error: auth.error };
  const { user, admin } = auth;

  const { error, count } = await admin
    .from("announcements")
    .update({ status: archived ? "ARCHIVED" : "PUBLISHED" }, { count: "exact" })
    .eq("id", announcementId)
    .eq("tenant_id", user.tenantId);

  if (error) return { error: `Could not update: ${error.message}` };
  if (count === 0) return { error: "That announcement no longer exists." };

  await new SupabaseAuditLogRepository(admin).write({
    tenantId: user.tenantId,
    actorProfileId: user.actorProfileId,
    action: archived ? "ANNOUNCEMENT_ARCHIVED" : "ANNOUNCEMENT_RESTORED",
    entityType: "announcement",
    entityId: announcementId,
    after: { archived },
  });

  revalidatePath("/admin/announcements");
  revalidatePath("/student");
  return { success: archived ? "Withdrawn from student screens." : "Showing again." };
}
