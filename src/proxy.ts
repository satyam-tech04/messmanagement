/**
 * Route gating and session refresh.
 *
 * Next 16 renamed `middleware.ts` to `proxy.ts` and the exported function to
 * `proxy`. The runtime is nodejs only — the edge runtime is not supported here.
 *
 * Two jobs:
 *
 * 1. **Refresh the session on every request.** Server Components cannot set
 *    cookies, so if the access token is not refreshed here, a rotated token is
 *    computed and then thrown away, and the user is silently logged out when
 *    the old one expires. This is the single most common cause of "random
 *    logouts" in Supabase SSR apps.
 *
 * 2. **Gate routes by role**, read straight from the verified JWT claims. No
 *    database round trip: this runs before every page and asset request, and a
 *    query here would tax the whole app.
 *
 * This is a coarse first line only. It cannot express "staff may verify
 * attendance but not issue refunds" — that is the application layer's job, and
 * RLS is the third layer beneath both (§5.1). Deliberately three layers.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ["/login", "/auth/callback"];

/** Route prefix → roles allowed to enter it. */
const ROLE_GATES: ReadonlyArray<{ prefix: string; allow: readonly string[] }> = [
  { prefix: "/admin", allow: ["ADMIN", "SUPER_ADMIN"] },
  // Admins can operate a counter; that is a real need during a rush, and the
  // manual-override audit trail records who actually did it.
  { prefix: "/staff", allow: ["STAFF", "ADMIN", "SUPER_ADMIN"] },
  { prefix: "/student", allow: ["STUDENT"] },
];

function homeFor(role: string | undefined): string {
  if (role === "STUDENT") return "/student";
  if (role === "STAFF") return "/staff";
  if (role === "ADMIN" || role === "SUPER_ADMIN") return "/admin";
  return "/login";
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Never let a CDN cache a response that sets auth cookies, or one
          // user's session token can be served to another.
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // Must be awaited before any response is returned, or a refresh completing
  // afterwards cannot write its cookies and the new token is lost.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as { sub?: string; user_role?: string } | undefined;

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isSignedIn = Boolean(claims?.sub);

  // --- Unauthenticated: everything except public paths goes to /login ---
  if (!isSignedIn) {
    if (isPublic) return response;

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve where they were headed so login can return them there. Only the
    // path, never a full URL — an attacker-supplied absolute `next` is an open
    // redirect.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // --- Authenticated: keep them out of the login page ---
  if (pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = homeFor(claims?.user_role);
    url.search = "";
    return NextResponse.redirect(url);
  }

  // --- Send the root to the right shell for this role ---
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = homeFor(claims?.user_role);
    return NextResponse.redirect(url);
  }

  // --- Role gates ---
  const gate = ROLE_GATES.find((g) => pathname === g.prefix || pathname.startsWith(`${g.prefix}/`));
  if (gate && !gate.allow.includes(claims?.user_role ?? "")) {
    // Redirect to their own shell rather than showing a 403. A student who
    // taps an admin link should land somewhere useful, not a dead end.
    const url = request.nextUrl.clone();
    url.pathname = homeFor(claims?.user_role);
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  /**
   * Skip static assets and image optimisation. Without this the proxy runs on
   * every CSS, JS and font request — which both wastes work and, because the
   * unauthenticated branch redirects, would break asset loading on /login.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
