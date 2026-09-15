import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarOff,
  Check,
  ChefHat,
  ClipboardList,
  LogIn,
  QrCode,
  Receipt,
  ShieldCheck,
  Smartphone,
  UtensilsCrossed,
} from "lucide-react";
import { AuroraBackdrop, AuroraEyebrow, AuroraMark } from "@/components/aurora-backdrop";
import { ThemeToggle } from "@/components/theme-toggle";
import { APP_NAME, SUPPORT_EMAIL } from "@/lib/app-info";
import { cn } from "@/lib/utils";
import {
  DAY_STEPS,
  FEATURES,
  HERO_STATS,
  MARQUEE,
  NAV_LINKS,
  PRICING,
  PRINCIPLES,
  ABOUT_PARAGRAPHS,
  SURFACES,
  type Feature,
} from "./content";
import { ScrollProgress } from "./scroll-progress";

export const metadata: Metadata = {
  title: `${APP_NAME} — Hostel mess management with signed QR attendance`,
  description:
    "MealAdda runs hostel mess operations: rotating signed QR meal attendance, meal plans, weekly menus, absences and a live headcount the kitchen can cook to.",
};

const FEATURE_ICONS: Record<Feature["icon"], typeof QrCode> = {
  QrCode,
  ChefHat,
  ClipboardList,
  UtensilsCrossed,
  CalendarOff,
  Receipt,
};

const LEGAL_SITE = "https://satyam-tech04.github.io/messmanagement";

function SectionHeading({
  eyebrow,
  title,
  body,
  id,
}: {
  eyebrow: string;
  title: React.ReactNode;
  body?: string;
  id: string;
}) {
  return (
    <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
      <div className="flex max-w-3xl flex-col gap-4">
        <AuroraEyebrow>{eyebrow}</AuroraEyebrow>
        <h2
          id={id}
          className="text-[clamp(2rem,4.2vw,3.6rem)] leading-[1.04] font-black tracking-[-0.03em]"
        >
          {title}
        </h2>
      </div>
      {body ? (
        <p className="text-muted-foreground max-w-[44ch] text-base leading-relaxed">{body}</p>
      ) : null}
    </div>
  );
}

/** A static rendering of what the counter actually checks — the "tech insight". */
function ScanTrace() {
  const rows: Array<[string, string, "ok" | "muted" | "plain"]> = [
    ["token", "v1.7f3c…e91a", "plain"],
    ["signature", "HMAC-SHA256 ✓", "ok"],
    ["expires_in", "12s", "plain"],
    ["student", "Roll 214 · ACTIVE", "plain"],
    ["plan", "Monthly · LUNCH, DINNER", "plain"],
    ["service_date", "2026-09-15 (Asia/Kolkata)", "muted"],
    ["already_served", "false", "plain"],
  ];
  return (
    <div className="bg-card/80 relative overflow-hidden rounded-3xl border shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-red-400/70" />
          <span className="size-2.5 rounded-full bg-amber-400/70" />
          <span className="size-2.5 rounded-full bg-emerald-400/70" />
        </div>
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em]">
          POST /api/qr/verify
        </span>
      </div>
      <dl className="space-y-2.5 px-5 py-5 font-mono text-[13px]">
        {rows.map(([k, v, tone]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{k}</dt>
            <dd
              className={cn(
                "text-right",
                tone === "ok" && "text-live font-semibold",
                tone === "muted" && "text-muted-foreground",
              )}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <div className="aurora-fill flex items-center justify-between px-5 py-4">
        <span className="flex items-center gap-2 text-lg font-black tracking-tight">
          <Check className="size-5" aria-hidden="true" /> SERVED · LUNCH
        </span>
        <span className="font-mono text-xs opacity-80">verdict</span>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const year = new Date().getFullYear();

  return (
    <div className="relative min-h-svh overflow-x-clip">
      <ScrollProgress />
      <AuroraBackdrop />

      <div className="relative z-10">
        {/* ── Header ─────────────────────────────────────────────── */}
        <header
          className="sticky top-0 z-40 border-b backdrop-blur-xl"
          style={{ background: "var(--glass-header)" }}
        >
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-8">
            <Link href="/" className="flex items-center gap-3" aria-label={`${APP_NAME} home`}>
              <AuroraMark />
              <span className="font-heading text-sm font-extrabold tracking-[0.22em] uppercase">
                {APP_NAME}
              </span>
            </Link>

            <nav
              aria-label="Sections"
              className="text-muted-foreground hidden items-center gap-8 text-[13px] tracking-wide md:flex"
            >
              {NAV_LINKS.map((l) => (
                <a key={l.href} href={l.href} className="hover:text-foreground transition-colors">
                  {l.label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              <ThemeToggle className="hidden sm:inline-flex" />
              <Link
                href="/login"
                className="bg-foreground text-background focus-visible:ring-ring/50 inline-flex h-10 items-center gap-2 rounded-full px-5 text-[13px] font-bold transition-transform hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:outline-none"
              >
                <LogIn className="size-4" aria-hidden="true" />
                Sign in
              </Link>
            </div>
          </div>
          {/* Section links stay reachable on a phone, where the nav above hides. */}
          <nav
            aria-label="Sections"
            className="text-muted-foreground flex gap-5 overflow-x-auto border-t px-4 py-2 text-xs md:hidden"
          >
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-foreground whitespace-nowrap">
                {l.label}
              </a>
            ))}
            <ThemeToggle className="ml-auto shrink-0 sm:hidden" />
          </nav>
        </header>

        <main>
          {/* ── Hero ─────────────────────────────────────────────── */}
          <section
            aria-labelledby="hero-title"
            className="mx-auto flex max-w-7xl flex-col items-center gap-8 px-4 pt-20 pb-20 text-center sm:px-8 sm:pt-28"
          >
            <div className="aurora-chip aurora-rise inline-flex items-center gap-2.5 rounded-full px-4 py-2">
              <AuroraEyebrow pulse className="tracking-[0.14em]">
                Hostel mess OS · QR attendance + live headcount
              </AuroraEyebrow>
            </div>

            <h1
              id="hero-title"
              className="max-w-[16ch] text-[clamp(2.75rem,7.2vw,6.75rem)] leading-[0.96] font-black tracking-[-0.045em]"
            >
              <span className="aurora-rise inline-block" style={{ animationDelay: ".05s" }}>
                Every plate
              </span>{" "}
              <span className="aurora-rise inline-block" style={{ animationDelay: ".15s" }}>
                accounted for.
              </span>{" "}
              <span
                className="aurora-rise aurora-text inline-block"
                style={{ animationDelay: ".3s" }}
              >
                Every meal,
              </span>{" "}
              <span
                className="aurora-rise aurora-text inline-block"
                style={{ animationDelay: ".4s" }}
              >
                one scan.
              </span>
            </h1>

            <p
              className="text-muted-foreground aurora-rise max-w-[62ch] text-[clamp(1rem,1.35vw,1.2rem)] leading-relaxed"
              style={{ animationDelay: ".5s" }}
            >
              {APP_NAME} runs your hostel mess end to end —{" "}
              <span className="text-foreground font-semibold">meal plans</span>,{" "}
              <span className="text-foreground font-semibold">weekly menus</span>, signed{" "}
              <span className="text-foreground font-semibold">QR attendance</span> at the counter
              and a <span className="text-foreground font-semibold">live headcount</span> the
              kitchen can cook to.
            </p>

            <div
              className="aurora-rise flex flex-wrap justify-center gap-3"
              style={{ animationDelay: ".6s" }}
            >
              <Link
                href="/login"
                className="aurora-fill aurora-glow focus-visible:ring-ring/50 inline-flex h-14 items-center gap-2 rounded-full px-8 text-[15px] font-extrabold transition-transform hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:outline-none"
              >
                Sign in to your mess
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <a
                href="#pricing"
                className="aurora-chip focus-visible:ring-ring/50 inline-flex h-14 items-center rounded-full px-8 text-[15px] font-semibold transition-transform hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:outline-none"
              >
                See pricing
              </a>
            </div>

            <dl
              className="aurora-rise mt-10 grid w-full max-w-5xl grid-cols-2 gap-4 lg:grid-cols-4"
              style={{ animationDelay: ".7s" }}
            >
              {HERO_STATS.map((s, i) => (
                <div
                  key={s.label}
                  className="bg-card/60 rounded-2xl border p-5 text-left backdrop-blur-md transition-transform duration-300 hover:-translate-y-1.5"
                >
                  <dd
                    className={cn(
                      "font-heading text-3xl font-black tracking-tight",
                      i === 0 && "text-aurora-1",
                    )}
                  >
                    {s.value}
                  </dd>
                  <dt className="text-muted-foreground mt-2 font-mono text-[10px] tracking-[0.14em]">
                    {s.label}
                  </dt>
                </div>
              ))}
            </dl>
          </section>

          {/* ── Marquee ──────────────────────────────────────────── */}
          <div
            aria-hidden="true"
            className="overflow-hidden border-y py-4"
            style={{ background: "var(--chip)" }}
          >
            <div className="aurora-marquee text-muted-foreground flex w-max font-mono text-xs tracking-[0.2em]">
              {[0, 1].map((copy) => (
                <div key={copy} className="flex gap-11 pr-11">
                  {MARQUEE.map((item) => (
                    <span key={item} className="flex items-center gap-11">
                      {item}
                      <span className="text-aurora-1">✦</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* ── Features ─────────────────────────────────────────── */}
          <section
            id="features"
            aria-labelledby="features-title"
            className="mx-auto max-w-7xl scroll-mt-24 px-4 py-24 sm:px-8"
          >
            <SectionHeading
              id="features-title"
              eyebrow="Core features"
              title={
                <>
                  Built for the mess counter,{" "}
                  <span className="aurora-text">not a restaurant POS</span>
                </>
              }
              body="Six parts of running a hostel mess, designed around what actually goes wrong at 1pm with two hundred students in the queue."
            />

            <div className="bg-border grid gap-px overflow-hidden rounded-3xl border sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => {
                const Icon = FEATURE_ICONS[f.icon];
                return (
                  <article
                    key={f.title}
                    className="bg-card/90 flex flex-col gap-4 p-8 backdrop-blur"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-aurora-1 font-mono text-[11px] tracking-[0.16em]">
                        {f.tag}
                      </span>
                      <span className="aurora-chip text-aurora-1 flex size-10 items-center justify-center rounded-xl">
                        <Icon className="size-5" aria-hidden="true" />
                      </span>
                    </div>
                    <h3 className="text-2xl font-extrabold tracking-tight">{f.title}</h3>
                    <p className="text-muted-foreground text-[15px] leading-relaxed">{f.body}</p>
                    <ul className="mt-1 space-y-2 text-sm">
                      {f.points.map((p) => (
                        <li key={p} className="flex gap-2.5">
                          <span className="text-aurora-1" aria-hidden="true">
                            ▸
                          </span>
                          {p}
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>
          </section>

          {/* ── How it works ─────────────────────────────────────── */}
          <section
            id="how-it-works"
            aria-labelledby="how-title"
            className="mx-auto max-w-7xl scroll-mt-24 px-4 pb-24 sm:px-8"
          >
            <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <SectionHeading
                  id="how-title"
                  eyebrow="A day in the mess"
                  title={
                    <>
                      From menu to plate, <span className="aurora-text">verified in one scan</span>
                    </>
                  }
                />
                <ol className="grid gap-6 border-t pt-8 sm:grid-cols-2">
                  {DAY_STEPS.map((s) => (
                    <li key={s.step} className="flex flex-col gap-2">
                      <span className="text-aurora-1 font-mono text-[11px] tracking-[0.14em]">
                        {s.step}
                      </span>
                      <span className="text-xl font-extrabold">{s.title}</span>
                      <span className="text-muted-foreground text-sm leading-relaxed">
                        {s.body}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="relative">
                <div
                  aria-hidden="true"
                  className="absolute -inset-8 rounded-[3rem] opacity-70 blur-3xl"
                  style={{ background: "radial-gradient(circle, var(--orb-2), transparent 70%)" }}
                />
                <div className="relative">
                  <p className="text-muted-foreground mb-3 flex items-center gap-2 font-mono text-[11px] tracking-[0.14em]">
                    <ShieldCheck className="text-aurora-1 size-4" aria-hidden="true" />
                    WHAT ONE SCAN CHECKS
                  </p>
                  <ScanTrace />
                </div>
              </div>
            </div>

            <div className="mt-20 grid gap-5 md:grid-cols-3">
              {SURFACES.map((s) => (
                <div
                  key={s.name}
                  className="bg-card/70 relative overflow-hidden rounded-3xl border p-7 backdrop-blur-xl"
                >
                  <span
                    aria-hidden="true"
                    className="aurora-sweep absolute top-0 left-0 h-0.5 w-2/5"
                    style={{
                      background:
                        "linear-gradient(90deg, transparent, var(--aurora-1), transparent)",
                    }}
                  />
                  <Smartphone className="text-aurora-1 mb-4 size-5" aria-hidden="true" />
                  <p className="text-muted-foreground font-mono text-[10px] tracking-[0.16em]">
                    {s.platform}
                  </p>
                  <h3 className="mt-2 text-xl font-extrabold">{s.name}</h3>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{s.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Pricing ──────────────────────────────────────────── */}
          <section
            id="pricing"
            aria-labelledby="pricing-title"
            className="mx-auto max-w-7xl scroll-mt-24 px-4 pb-24 sm:px-8"
          >
            <SectionHeading
              id="pricing-title"
              eyebrow="Pricing"
              title={
                <>
                  Priced per mess, <span className="aurora-text">sized to your hostel</span>
                </>
              }
              body="Every mess is different — how many students, how many meals a day, one hostel or several. Tell us about yours and we'll put a quote together."
            />

            <div className="grid gap-5 lg:grid-cols-3">
              {PRICING.map((tier) => (
                <div
                  key={tier.name}
                  className={cn(
                    "relative flex flex-col gap-6 overflow-hidden rounded-3xl border p-8 backdrop-blur-xl",
                    tier.highlight ? "border-aurora-1/60 bg-card aurora-glow" : "bg-card/70",
                  )}
                >
                  {tier.highlight ? (
                    <span className="aurora-fill absolute top-6 right-6 rounded-full px-3 py-1 font-mono text-[10px] font-bold tracking-[0.14em]">
                      RECOMMENDED
                    </span>
                  ) : null}
                  <div className="space-y-2">
                    <h3 className="text-2xl font-black tracking-tight">{tier.name}</h3>
                    <p className="text-muted-foreground text-sm">{tier.tagline}</p>
                  </div>
                  <div>
                    <p className="font-heading text-4xl font-black tracking-tight">Talk to us</p>
                    <p className="text-muted-foreground mt-1 font-mono text-[11px] tracking-[0.12em]">
                      QUOTED PER MESS
                    </p>
                  </div>
                  <ul className="flex-1 space-y-3 text-sm">
                    {tier.features.map((f) => (
                      <li key={f} className="flex gap-3">
                        <Check
                          className="text-aurora-1 mt-0.5 size-4 shrink-0"
                          aria-hidden="true"
                        />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${APP_NAME} ${tier.name} plan`)}`}
                    className={cn(
                      "focus-visible:ring-ring/50 inline-flex h-12 items-center justify-center gap-2 rounded-full text-sm font-bold transition-transform hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:outline-none",
                      tier.highlight ? "aurora-fill" : "aurora-chip",
                    )}
                  >
                    {tier.cta}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </a>
                </div>
              ))}
            </div>
          </section>

          {/* ── About ────────────────────────────────────────────── */}
          <section
            id="about"
            aria-labelledby="about-title"
            className="mx-auto max-w-7xl scroll-mt-24 px-4 pb-24 sm:px-8"
          >
            <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="flex flex-col gap-5">
                <AuroraEyebrow>About us</AuroraEyebrow>
                <h2
                  id="about-title"
                  className="text-[clamp(2rem,4.2vw,3.6rem)] leading-[1.04] font-black tracking-[-0.03em]"
                >
                  We build for the <span className="aurora-text">three rushes</span> a day
                </h2>
                {ABOUT_PARAGRAPHS.map((text) => (
                  <p
                    key={text.slice(0, 24)}
                    className="text-muted-foreground text-base leading-relaxed"
                  >
                    {text}
                  </p>
                ))}
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="text-aurora-1 inline-flex w-fit items-center gap-2 text-sm font-bold"
                >
                  {SUPPORT_EMAIL}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </a>
              </div>

              <div className="bg-border grid gap-px overflow-hidden rounded-3xl border sm:grid-cols-2">
                {PRINCIPLES.map((p, i) => (
                  <div key={p.title} className="bg-card/90 flex flex-col gap-3 p-7 backdrop-blur">
                    <span className="text-aurora-1 font-mono text-[11px] tracking-[0.16em]">
                      PRINCIPLE {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-lg font-extrabold">{p.title}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">{p.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── Closing CTA ──────────────────────────────────────── */}
          <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-8">
            <div className="bg-card/70 relative flex flex-col items-center gap-6 overflow-hidden rounded-[2rem] border px-6 py-20 text-center backdrop-blur-xl">
              <div
                aria-hidden="true"
                className="aurora-spin absolute inset-x-[30%] -inset-y-[40%]"
                style={{
                  background:
                    "conic-gradient(from 0deg, transparent, var(--orb-2), transparent 40%)",
                }}
              />
              <h2 className="relative max-w-[22ch] text-[clamp(1.9rem,4.4vw,3.6rem)] leading-[1.05] font-black tracking-[-0.03em]">
                Ready to run your mess on {APP_NAME}?
              </h2>
              <p className="text-muted-foreground relative max-w-[56ch] text-base leading-relaxed">
                Mess admins sign in on the web. Students and counter staff use the {APP_NAME} app.
              </p>
              <div className="relative flex flex-wrap justify-center gap-3">
                <Link
                  href="/login"
                  className="bg-foreground text-background inline-flex h-12 items-center gap-2 rounded-full px-7 text-sm font-extrabold transition-transform hover:-translate-y-0.5"
                >
                  <LogIn className="size-4" aria-hidden="true" />
                  Admin sign in
                </Link>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="aurora-chip inline-flex h-12 items-center rounded-full px-7 text-sm font-semibold transition-transform hover:-translate-y-0.5"
                >
                  Book a walkthrough
                </a>
              </div>
              <p className="text-live relative inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.14em]">
                <span className="aurora-pulse bg-live size-1.5 rounded-full" aria-hidden="true" />
                LIVE IN A HOSTEL MESS TODAY
              </p>
            </div>
          </section>
        </main>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <footer className="text-muted-foreground border-t">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-4 py-10 text-[13px] sm:px-8">
            <div className="flex items-center gap-3">
              <AuroraMark className="size-5 rounded-md" />
              <span className="text-foreground font-heading font-extrabold tracking-[0.2em] uppercase">
                {APP_NAME}
              </span>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap gap-6">
              <a href="#features" className="hover:text-foreground">
                Features
              </a>
              <a href="#pricing" className="hover:text-foreground">
                Pricing
              </a>
              <a href={`${LEGAL_SITE}/privacy/`} className="hover:text-foreground">
                Privacy
              </a>
              <a href={`${LEGAL_SITE}/terms/`} className="hover:text-foreground">
                Terms
              </a>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-foreground">
                Support
              </a>
            </nav>
            <p className="font-mono text-[11px] tracking-[0.1em]">
              © {year} {APP_NAME.toUpperCase()} · HOSTEL MESS OS
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
