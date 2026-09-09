/**
 * Session → `TenantContext` resolution (§5.1).
 *
 * Every use case takes a `TenantContext` built here, **server-side, from the
 * session**. A `tenantId` arriving in a request body is an attacker's
 * suggestion, not a fact, and nothing in this file ever reads one.
 *
 * `getClaims()` rather than `getSession()`: it verifies the JWT signature and
 * returns the custom `tenant_id` / `user_role` claims injected by
 * `custom_access_token_hook`. `getSession()` returns whatever is in the cookie
 * without verifying it, which is precisely the value an attacker controls.
 */
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/core/domain/tenant-context";
import type { UserRole } from "@/core/domain/enums";
import { createClient } from "../supabase/server";
import { createBearerClient } from "../supabase/bearer";
import { firstRelated } from "../supabase/mappers";
import { parseBearerToken } from "@/lib/bearer-token";
import type { Database } from "../supabase/database.types";

export interface SessionUser extends TenantContext {
  /** Gates every route until the user chooses their own password (D-02). */
  readonly mustChangePassword: boolean;
  readonly fullName: string;
  readonly profileStatus: "ACTIVE" | "DISABLED";
  /** The mess's own name, shown to its members in place of ours. */
  readonly tenantName: string;
  /** Storage path of the mess's logo, if it has uploaded one. */
  readonly tenantLogoPath: string | null;
}

/**
 * The current user, or null when unauthenticated.
 *
 * Wrapped in React `cache` so that a layout, a page and several components in
 * one render share a single database round trip rather than issuing one each.
 * The cache is per-request, so it cannot leak one user's context into another's.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // A bearer token wins when one is present, so **every** existing caller —
  // pages, Server Actions and route handlers alike — serves the mobile app
  // without being rewritten. There are 115 of them; making the chokepoint
  // transport-aware is the only version of this that does not mean touching
  // each one and getting one wrong.
  //
  // A browser never sends this header, so the cookie path is untouched. And a
  // header alone grants nothing: the token below is signature-verified, so
  // inventing one gets you no further than inventing a cookie would.
  const token = parseBearerToken((await headers()).get("authorization"));
  if (token) return getSessionUserFromToken(token);

  const supabase = await createClient();

  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;

  const claims = data.claims as {
    sub?: string;
    tenant_id?: string;
    user_role?: string;
  };
  if (!claims.sub) return null;

  return resolveSessionUser(supabase, claims.sub);
});

/**
 * The same user, resolved from an `Authorization: Bearer` token instead of a
 * cookie — the mobile app's transport.
 *
 * Returns the **identical `SessionUser`**, so every use case, policy and route
 * handler behind this function is transport-agnostic and neither knows nor
 * cares which client is calling.
 *
 * The token is verified, not trusted: `getClaims(accessToken)` checks the
 * signature against the project's JWKS exactly as the cookie path does. An
 * expired or forged token yields no claims and this returns null.
 *
 * Cached per token rather than per request. `cache()` keys on arguments, so two
 * different callers in one render cannot collide — but note the key is the
 * token itself, which is what makes that safe.
 */
export const getSessionUserFromToken = cache(
  async (accessToken: string): Promise<SessionUser | null> => {
    const supabase = createBearerClient(accessToken);

    const { data, error } = await supabase.auth.getClaims(accessToken);
    if (error || !data?.claims) return null;

    const claims = data.claims as { sub?: string };
    if (!claims.sub) return null;

    return resolveSessionUser(supabase, claims.sub);
  },
);

/**
 * Claims → `SessionUser`, shared by both transports.
 *
 * Kept in one place deliberately: the fail-closed rules below are the whole
 * authorization story for a suspended tenant or a disabled account, and a
 * second copy that drifted would be a silent way back in.
 */
async function resolveSessionUser(
  supabase: SupabaseClient<Database>,
  sub: string,
): Promise<SessionUser | null> {
  // Profile, tenant and student in one round trip. This runs on every
  // authenticated request, so a second query here would be felt everywhere.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      `id, tenant_id, role, full_name, status, must_change_password,
       tenants!inner ( slug, name, timezone, status, logo_path ),
       students ( id )`,
    )
    .eq("id", sub)
    .maybeSingle();

  // Fail closed (§2.7). A session whose profile cannot be read is
  // indeterminate, and indeterminate means unauthenticated.
  if (profileError || !profile) return null;

  const tenant = firstRelated<{
    slug: string;
    name: string;
    timezone: string;
    status: string;
    logo_path: string | null;
  }>(profile.tenants as never);
  if (!tenant) return null;

  // A suspended tenant or a disabled account must not hold a usable session,
  // even though their JWT is still cryptographically valid until it expires.
  if (tenant.status !== "ACTIVE") return null;
  if (profile.status !== "ACTIVE") return null;

  // PostgREST collapses this embed to a single OBJECT, not an array, because
  // `students.profile_id` is unique. Reading `students[0]` silently yielded
  // undefined and left every student session without a studentId — which the
  // QR endpoint then refused as FORBIDDEN. See firstRelated().
  const studentId = firstRelated<{ id: string }>(profile.students as never)?.id;

  return {
    tenantId: profile.tenant_id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    tenantLogoPath: tenant.logo_path,
    timezone: tenant.timezone,
    actorProfileId: profile.id,
    role: profile.role as UserRole,
    ...(studentId ? { studentId } : {}),
    mustChangePassword: profile.must_change_password,
    fullName: profile.full_name,
    profileStatus: profile.status,
  };
}

/**
 * The current user, or throws.
 *
 * For code paths already behind route gating, where "no session" means the
 * gating is broken rather than a case to render.
 */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("No authenticated session");
  return user;
}

/** The landing route for a role. One place, so gating and redirects agree. */
export function homeRouteFor(role: UserRole): string {
  switch (role) {
    case "STUDENT":
      return "/student";
    case "STAFF":
      return "/staff";
    case "ADMIN":
    case "SUPER_ADMIN":
      return "/admin";
  }
}
