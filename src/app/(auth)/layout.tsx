import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ChefHat } from "lucide-react";
import { AuroraBackdrop, AuroraEyebrow, AuroraMark } from "@/components/aurora-backdrop";
import { MEAL_TIMES, MealChip, ThaliIllustration } from "@/components/mess-illustrations";
import { ThemeToggle } from "@/components/theme-toggle";
import { APP_NAME } from "@/lib/app-info";

/**
 * Shell for unauthenticated screens.
 *
 * Two panes on desktop: the form on a glass card, and a mess scene beside it —
 * a steaming thali and the day's meal times, so signing in feels like walking
 * into the dining hall rather than a server console. The scene collapses away
 * on a phone, where it would push the password field below the fold.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-svh overflow-hidden">
      <AuroraBackdrop />

      <div className="relative z-10 grid min-h-svh lg:grid-cols-[1fr_1.05fr]">
        <div className="flex flex-col gap-8 p-6 sm:p-10">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2.5" aria-label={`${APP_NAME} home`}>
              <AuroraMark />
              <span className="font-heading text-lg font-black tracking-tight">{APP_NAME}</span>
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
            <span>
              © {new Date().getFullYear()} {APP_NAME}
            </span>
          </div>
        </div>

        <div
          className="relative hidden overflow-hidden border-l lg:block"
          style={{ background: "var(--chip)" }}
        >
          <div className="relative flex h-full flex-col justify-center gap-8 p-14 xl:p-20">
            <AuroraEyebrow>
              <ChefHat className="size-4" aria-hidden="true" />
              Your mess, today
            </AuroraEyebrow>
            <p className="max-w-[16ch] text-5xl leading-[1.02] font-black tracking-[-0.04em] xl:text-6xl">
              Plan the menu. <span className="aurora-text">Serve every plate.</span>
            </p>
            <p className="text-muted-foreground max-w-[42ch] text-lg leading-relaxed">
              Menus, meal plans, the counter and tonight&apos;s headcount — all waiting for you
              inside.
            </p>
            <div className="relative z-10 grid max-w-lg grid-cols-2 gap-3">
              {MEAL_TIMES.map((m) => (
                <MealChip key={m.meal} {...m} />
              ))}
            </div>
            <ThaliIllustration className="plate-float pointer-events-none absolute -right-36 -bottom-44 w-[400px] opacity-90" />
          </div>
        </div>
      </div>
    </div>
  );
}
