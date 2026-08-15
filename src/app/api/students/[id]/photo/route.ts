/**
 * Serves a student's photo to authorised members of their own mess.
 *
 * The bucket is private, so this route is the only way in. It exists rather
 * than a signed URL because the counter is on a latency budget: an `<img>` here
 * loads in parallel with rendering the scan result, whereas minting a signed
 * URL would add a round trip to the scan response itself, before staff see
 * anything.
 *
 * Photographs of named students are personal data. This checks the session
 * before reading anything, and the storage policies enforce the same tenancy
 * rule underneath (rule 8) — so a bug here still cannot cross a mess boundary.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/infra/auth/session";
import { createAdminClient } from "@/infra/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: RouteContext<"/api/students/[id]/photo">) {
  const { id } = await context.params;

  const user = await getSessionUser();
  if (!user) return new NextResponse(null, { status: 401 });

  // Staff need this at the counter; the admin needs it on the student's page.
  // A student has no reason to fetch another student's photograph.
  if (user.role !== "STAFF" && user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return new NextResponse(null, { status: 403 });
  }

  if (!UUID.test(id)) return new NextResponse(null, { status: 404 });

  const admin = createAdminClient();

  // Tenant-scoped: another mess's student id is a 404, not a photograph.
  const { data: student } = await admin
    .from("students")
    .select("id, profiles!inner ( photo_url )")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  const profile = student?.profiles as unknown as { photo_url: string | null } | null;
  const path = profile?.photo_url;
  if (!path) return new NextResponse(null, { status: 404 });

  // Defence in depth: the stored path must sit under this tenant's folder. A
  // path written by some future bug cannot be used to read across a boundary.
  if (!path.startsWith(`${user.tenantId}/`)) return new NextResponse(null, { status: 404 });

  const { data: file, error } = await admin.storage.from("student-photos").download(path);
  if (error || !file) return new NextResponse(null, { status: 404 });

  return new NextResponse(file, {
    headers: {
      "Content-Type": file.type || "image/jpeg",
      // Private: a shared CDN must never hold one mess's student photographs.
      // Short client-side cache so a queue of scans does not refetch the same
      // face repeatedly.
      "Cache-Control": "private, max-age=300",
    },
  });
}
