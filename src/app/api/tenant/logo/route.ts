/**
 * Serves the signed-in user's own mess's logo.
 *
 * No id in the path, deliberately. The tenant comes from the session, so this
 * route cannot be used to enumerate other hostels' branding — which a public
 * bucket or an id-addressed route would both allow.
 *
 * Cached privately and briefly: a logo changes about once, but it is fetched on
 * every cold start of every student's app.
 */
import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/infra/http/api-auth";
import { createAdminClient } from "@/infra/supabase/admin";

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return new NextResponse(null, { status: auth.status });

  const { user } = auth.caller;
  if (!user.tenantLogoPath) return new NextResponse(null, { status: 404 });

  // The path is read from the session's own tenant row, never from the request,
  // so there is nothing here a caller could point at another mess's object.
  const { data, error } = await createAdminClient()
    .storage.from("tenant-logos")
    .download(user.tenantLogoPath);

  if (error || !data) return new NextResponse(null, { status: 404 });

  return new NextResponse(await data.arrayBuffer(), {
    headers: {
      "Content-Type": data.type || "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
}
