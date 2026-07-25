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
import type { TenantContext } from "@/core/domain/tenant-context";
import type { UserRole } from "@/core/domain/enums";
import { createClient } from "../supabase/server";
import { firstRelated } from "../supabase/mappers";

export interface SessionUser extends TenantContext {
  /** Gates every route until the user chooses their own password (D-02). */
  readonly mustChangePassword: boolean;
  readonly fullName: string;
  readonly profileStatus: "ACTIVE" | "DISABLED";
}

/**
 * The current user, or null when unauthenticated.
 *
 * Wrapped in React `cache` so that a layout, a page and several components in
 * one render share a single database round trip rather than issuing one each.
 * The cache is per-request, so it cannot leak one user's context into another's.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;

  const claims = data.claims as {
    sub?: string;
    tenant_id?: string;
    user_role?: string;
  };
  if (!claims.sub) return null;

  // Profile, tenant and student in one round trip. This runs on every
  // authenticated request, so a second query here would be felt everywhere.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      `id, tenant_id, role, full_name, status, must_change_password,
       tenants!inner ( slug, timezone, status ),
       students ( id )`,
    )
    .eq("id", claims.sub)
    .maybeSingle();

  // Fail closed (§2.7). A session whose profile cannot be read is
  // indeterminate, and indeterminate means unauthenticated.
  if (profileError || !profile) return null;

  const tenant = firstRelated<{ slug: string; timezone: string; status: string }>(
    profile.tenants as never,
  );
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
    timezone: tenant.timezone,
    actorProfileId: profile.id,
    role: profile.role as UserRole,
    ...(studentId ? { studentId } : {}),
    mustChangePassword: profile.must_change_password,
    fullName: profile.full_name,
    profileStatus: profile.status,
  };
});

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
