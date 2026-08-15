import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSessionUser } from "@/infra/auth/session";
import { createClient } from "@/infra/supabase/server";
import { createAdminClient } from "@/infra/supabase/admin";
import { SupabaseTenantRepository } from "@/infra/supabase/repositories";
import { signOut } from "@/app/(auth)/login/actions";

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
  if (user.mustChangePassword) redirect("/change-password");

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
      }}
      signOutAction={signOut}
    >
      {children}
    </AppShell>
  );
}
