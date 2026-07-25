import type { ReactNode } from "react";
import { UtensilsCrossed } from "lucide-react";

/**
 * Shell for unauthenticated screens.
 *
 * Two panes on desktop: the form on the left, a branded panel on the right that
 * collapses away entirely on mobile — students sign in on a phone, and half a
 * screen of decoration there would push the password field below the fold.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-8 p-6 sm:p-10">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
            <UtensilsCrossed className="size-5" aria-hidden="true" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Mess OS</span>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">{children}</div>
        </div>

        <p className="text-muted-foreground text-center text-xs lg:text-left">
          © {new Date().getFullYear()} Mess OS
        </p>
      </div>

      <div className="relative hidden overflow-hidden bg-slate-950 lg:block">
        {/* Decorative only; conveys no information, so it is hidden from AT. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(16,185,129,0.18),transparent_55%),radial-gradient(circle_at_75%_70%,rgba(56,189,248,0.14),transparent_50%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 [background-image:linear-gradient(to_right,rgb(148_163_184/0.4)_1px,transparent_1px),linear-gradient(to_bottom,rgb(148_163_184/0.4)_1px,transparent_1px)] [background-size:56px_56px] opacity-[0.15]"
        />
        <div className="relative flex h-full flex-col justify-end gap-6 p-12">
          <blockquote className="max-w-md space-y-4">
            <p className="text-2xl leading-snug font-medium text-white">
              Scan, verify, serve. The kitchen knows the headcount before it starts cooking.
            </p>
            <footer className="text-sm text-slate-400">
              Mess management for hostels — attendance, plans and menus in one place.
            </footer>
          </blockquote>
        </div>
      </div>
    </div>
  );
}
