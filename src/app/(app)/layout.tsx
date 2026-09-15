import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";
import { signOut } from "@/app/(auth)/login/actions";
import { exitImpersonation } from "@/app/(operator)/superuser/actions";
import { AppOnlyNotice } from "@/components/app-only-notice";
import { canSignInOnWeb } from "@/core/policies/operator-access.policy";
import { readImpersonation } from "@/infra/auth/impersonation";
import { serverEnv } from "@/lib/env.server";

/**
 * Shell for every authenticated surface.
 *
 * `proxy.ts` has already gated by role from the JWT, but the forced
 * password-change check lives HERE rather than there, deliberately. The flag
 * cannot go in the JWT: a token issued before the change would still carry
 * `mustChangePassword: true` until it refreshed, trapping the user in a loop
 * immediately after they successfully set a password.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();

  // Belt and braces behind the proxy. If this ever fires, route gating is
  // broken — and failing closed is the right response either way.
  if (!user) redirect("/login");

  // The operator inside a student's account. Verified and bound to this
  // session, so a student cannot mint one to dodge the checks below.
  const impersonation =
    user.role === "STUDENT" ? await readImpersonation(user.actorProfileId) : null;

  // Never while impersonating: the operator must not choose a student's password.
  if (user.mustChangePassword && !impersonation) redirect("/change-password");

  // Sessions that predate the app-only switch are turned away here, not only at
  // the sign-in form. Rendered rather than redirected: signing out needs a
  // cookie write, which a layout cannot do, and a GET that signs people out is
  // a link anyone could send them.
  if (!impersonation && !canSignInOnWeb(user.role, { appOnly: serverEnv.WEB_SIGNIN_APP_ONLY })) {
    return <AppOnlyNotice fullName={user.fullName} role={user.role} signOutAction={signOut} />;
  }

  // One cached read, not two live queries. This layout wraps every authenticated
  // page, so what was here ran on every navigation in the app for a name that
  // never changes and two booleans that change twice a year.
  const supabase = await createClient();
  const admin = createAdminClient();
  const chrome = await new SupabaseTenantRepository(supabase, admin).getChrome(user.tenantId);

  return (
    <AppShell
      user={{
        fullName: user.fullName,
        role: user.role,
        tenantName: chrome?.name ?? "Mess",
      }}
      features={{
        allowMealSkipping: chrome?.allowMealSkipping ?? false,
        allowAwayRequests: chrome?.allowAwayRequests ?? false,
        allowAnnouncements: chrome?.allowAnnouncements ?? false,
        allowFeedback: chrome?.allowFeedback ?? false,
      }}
      signOutAction={signOut}
      impersonation={
        impersonation ? { studentName: user.fullName, exitAction: exitImpersonation } : undefined
      }
    >
      {children}
    </AppShell>
  );
}
