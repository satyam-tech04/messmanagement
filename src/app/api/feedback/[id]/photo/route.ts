/**
 * Serves the photo a student attached to their feedback.
 *
 * The bucket is private, and this route is the only way in. A student
 * photographing their lunch will sometimes photograph the people around them,
 * in a hostel full of young adults — a public bucket would make every one of
 * those retrievable forever by anyone who guessed a URL.
 *
 * The session is checked before anything is read, and the storage policies in
 * migration 016 enforce the same tenancy rule underneath (rule 8), so a bug
 * here still cannot cross a mess boundary.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: RouteContext<"/api/feedback/[id]/photo">) {
  const { id } = await context.params;

  const user = await getSessionUser();
  if (!user) return new NextResponse(null, { status: 401 });
  if (!UUID.test(id)) return new NextResponse(null, { status: 404 });

  const admin = createAdminClient();

  // Tenant-scoped, so another mess's feedback id is a 404 rather than a photo.
  const { data: feedback } = await admin
    .from("meal_feedback")
    .select("id, student_id, photo_path")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  const path = feedback?.photo_path;
  if (!path) return new NextResponse(null, { status: 404 });

  // Staff and admins review all of it. A student may see their own photo back
  // and nobody else's — the review screen is not theirs.
  const isReviewer = user.role === "STAFF" || user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  const isOwner = user.role === "STUDENT" && user.studentId === feedback.student_id;
  if (!isReviewer && !isOwner) return new NextResponse(null, { status: 403 });

  // Defence in depth: the stored path must sit under this tenant's folder, so a
  // path written by some future bug cannot be used to read across a boundary.
  if (!path.startsWith(`${user.tenantId}/`)) return new NextResponse(null, { status: 404 });

  const { data: file, error } = await admin.storage.from("meal-feedback").download(path);
  if (error || !file) return new NextResponse(null, { status: 404 });

  return new NextResponse(file, {
    headers: {
      "Content-Type": file.type || "image/jpeg",
      // Private: a shared CDN must never hold one mess's photographs.
      "Cache-Control": "private, max-age=300",
    },
  });
}
