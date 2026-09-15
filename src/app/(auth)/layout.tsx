import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ShieldCheck } from "lucide-react";
import { AuroraBackdrop, AuroraEyebrow, AuroraMark } from "@/components/aurora-backdrop";
import { ThemeToggle } from "@/components/theme-toggle";
import { APP_NAME } from "@/lib/app-info";

const HIGHLIGHTS = [
  "Live headcount before the kitchen starts cooking",
  "Signed, rotating QR — screenshots get nobody fed",
  "Every override and account entry on the audit trail",
];

/**
 * Shell for unauthenticated screens.
 *
 * Two panes on desktop: the form on a glass card, and the Aurora story panel
 * beside it. The story collapses away entirely on a phone — half a screen of
 * decoration there would push the password field below the fold.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-svh overflow-hidden">
      <AuroraBackdrop />

      <div className="relative z-10 grid min-h-svh lg:grid-cols-[1fr_1.05fr]">
        <div className="flex flex-col gap-8 p-6 sm:p-10">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3" aria-label={`${APP_NAME} home`}>
              <AuroraMark />
              <span className="font-heading text-sm font-extrabold tracking-[0.22em] uppercase">
                {APP_NAME}
              </span>
            </Link>
            <ThemeToggle />
          </div>

          <div className="flex flex-1 items-center justify-center">
            <div className="bg-card/80 w-full max-w-md rounded-3xl border p-7 shadow-xl backdrop-blur-xl sm:p-9">
              {children}
            </div>
          </div>

          <div className="text-muted-foreground flex items-center justify-between gap-4 text-xs">
            <Link href="/" className="hover:text-foreground inline-flex items-center gap-1.5">
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Back to {APP_NAME}
            </Link>
            <span className="font-mono tracking-[0.1em]">
              © {new Date().getFullYear()} {APP_NAME.toUpperCase()}
            </span>
          </div>
        </div>

        <div className="relative hidden border-l lg:block" style={{ background: "var(--chip)" }}>
          <div className="relative flex h-full flex-col justify-center gap-10 p-14 xl:p-20">
            <AuroraEyebrow pulse>Mess operations console</AuroraEyebrow>
            <p className="max-w-[18ch] text-5xl leading-[1.02] font-black tracking-[-0.04em] xl:text-6xl">
              Scan, verify, serve. <span className="aurora-text">The kitchen already knows.</span>
            </p>
            <ul className="space-y-4">
              {HIGHLIGHTS.map((h) => (
                <li key={h} className="flex items-start gap-3 text-base">
                  <span className="aurora-fill mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
                    <Check className="size-3" aria-hidden="true" />
                  </span>
                  {h}
                </li>
              ))}
            </ul>
            <div className="bg-card/70 flex max-w-md items-center gap-4 rounded-2xl border p-5 backdrop-blur-xl">
              <ShieldCheck className="text-aurora-1 size-8 shrink-0" aria-hidden="true" />
              <p className="text-muted-foreground text-sm leading-relaxed">
                Each mess&rsquo;s data is isolated at the database. Signing in only ever opens your
                own hostel.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
