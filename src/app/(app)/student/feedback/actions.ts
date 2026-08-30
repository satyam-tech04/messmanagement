"use server";

/**
 * Student feedback — the one place a student writes to this system.
 *
 * The standing rule is that the student app is read-only: show a QR, view
 * details, view notifications. Feedback is the single exception the owner
 * asked for, because only the person who ate the food can rate it. It is
 * contained accordingly:
 *
 *   * gated by `allow_feedback`, which defaults to off and is checked HERE, not
 *     only in the UI — a hidden form is not a closed door;
 *   * one verdict per student per meal, enforced by a unique index, so
 *     re-submitting replaces an answer rather than stacking a second;
 *   * touches nothing operational. No eligibility, no attendance, no headcount,
 *     no money. If this file ever imports one of those, the feature has drifted.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ALL_MEAL_SLOTS, type MealSlot } from "@/core/domain/enums";
import { parseFeedbackDraft } from "@/core/policies/feedback.policy";
import { serviceDateOf, toServiceDate } from "@/core/time";
import { createAdminClient } from "@/infra/supabase/admin";
import { getSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";

export interface FeedbackActionState {
  readonly error?: string;
  readonly success?: string;
}

/** Matches the bucket's own limit, so the failure is caught before the upload. */
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

const schema = z.object({
  rating: z.coerce.number(),
  comment: z.string(),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date."),
  mealSlot: z.enum(ALL_MEAL_SLOTS as unknown as [MealSlot, ...MealSlot[]]),
});

export async function submitFeedback(
  _prev: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  if (user.role !== "STUDENT" || !user.studentId) {
    return { error: "Only a student can leave feedback about their own meal." };
  }
  const studentId = user.studentId;

  const supabase = await createClient();
  const admin = createAdminClient();
  const settings = await new SupabaseTenantRepository(supabase, admin).getSettings(user.tenantId);

  const parsed = schema.safeParse({
    rating: formData.get("rating"),
    comment: formData.get("comment") ?? "",
    serviceDate: formData.get("serviceDate") ?? "",
    mealSlot: formData.get("mealSlot") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const draft = parseFeedbackDraft({
    actorRole: user.role,
    featureEnabled: settings?.allowFeedback ?? false,
    rating: parsed.data.rating,
    comment: parsed.data.comment,
    serviceDate: toServiceDate(parsed.data.serviceDate),
    mealSlot: parsed.data.mealSlot,
    today: serviceDateOf(user.timezone, new Date()),
  });
  if (!draft.ok) return { error: draft.error.message };

  // --- The photo, if there is one -----------------------------------------
  //
  // Uploaded before the row is written, so a failed upload does not leave a
  // feedback row pointing at a file that never arrived. The reverse — a stored
  // file with no row — is harmless: nothing renders it.
  let photoPath: string | null = null;
  const photo = formData.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (!ALLOWED_PHOTO_TYPES.includes(photo.type)) {
      return { error: "Attach a JPEG, PNG or WebP image." };
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      return { error: "That photo is larger than 3 MB. Try again with a smaller one." };
    }

    // `{tenant}/{student}/{date}-{slot}` — the first segment IS the tenancy
    // boundary and the second is the student's own, both enforced by the
    // storage policies in migration 016 rather than trusted from here.
    photoPath = `${user.tenantId}/${studentId}/${draft.value.serviceDate}-${draft.value.mealSlot}`;
    const { error: uploadError } = await admin.storage
      .from("meal-feedback")
      .upload(photoPath, photo, { contentType: photo.type, upsert: true });
    if (uploadError) {
      return { error: `The photo could not be uploaded: ${uploadError.message}` };
    }
  }

  // One verdict per meal. `upsert` on the unique index rather than a
  // read-then-write, so a double tap on a bad connection produces one row.
  const { error } = await admin.from("meal_feedback").upsert(
    {
      tenant_id: user.tenantId,
      student_id: studentId,
      service_date: draft.value.serviceDate,
      meal_slot: draft.value.mealSlot,
      rating: draft.value.rating,
      comment: draft.value.comment,
      // Only overwrite the stored path when a new photo came with this
      // submission; editing a comment must not silently drop the picture.
      ...(photoPath ? { photo_path: photoPath } : {}),
    },
    { onConflict: "tenant_id,student_id,service_date,meal_slot" },
  );
  if (error) return { error: `Could not save your feedback: ${error.message}` };

  revalidatePath("/student/feedback");
  return { success: "Thanks — the mess can see this now." };
}
