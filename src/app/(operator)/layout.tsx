import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { AuroraBackdrop, AuroraMark } from "@/components/aurora-backdrop";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/infra/auth/session";
import { signOut } from "@/app/(auth)/login/actions";
import { APP_NAME } from "@/lib/app-info";

/**
 * The platform operator's own space: the persona chooser and the student picker.
 *
 * Outside the app shell on purpose. The operator arrives here before choosing
 * whose sidebar they want, so showing any one role's nav would pre-empt the
 * choice this screen exists to ask.
 */
export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  // proxy.ts gates /superuser by the JWT role; this is the belt behind it.
  // 404, as on /admin/messes: nobody else should learn this screen exists.
  if (user.role !== "SUPER_ADMIN") notFound();

  return (
    <div className="relative min-h-svh overflow-hidden">
      <AuroraBackdrop />

      <div className="relative z-10 flex min-h-svh flex-col">
        <header
          className="sticky top-0 z-30 border-b backdrop-blur-xl"
          style={{ background: "var(--glass-header)" }}
        >
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <Link href="/superuser" className="flex items-center gap-3">
              <AuroraMark />
              <span className="font-heading text-sm font-extrabold tracking-[0.2em] uppercase">
                {APP_NAME}
              </span>
              <span className="text-muted-foreground aurora-chip hidden rounded-full px-2.5 py-1 font-mono text-[10px] tracking-[0.16em] uppercase sm:inline">
                Platform
              </span>
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <form action={signOut}>
                <Button type="submit" variant="ghost" size="sm" aria-label="Sign out">
                  <LogOut className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Sign out</span>
                </Button>
              </form>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
          {children}
        </main>
      </div>
    </div>
  );
}
