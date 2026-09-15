import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarOff,
  Check,
  ChefHat,
  ClipboardList,
  GraduationCap,
  HeartHandshake,
  House,
  IndianRupee,
  Lock,
  LogIn,
  Megaphone,
  Moon,
  QrCode,
  Receipt,
  ShieldCheck,
  Soup,
  Store,
  Sunrise,
  UtensilsCrossed,
} from "lucide-react";
import { AuroraBackdrop } from "@/components/aurora-backdrop";
import {
  MEAL_TIMES,
  MealChip,
  PhoneMock,
  ThaliIllustration,
} from "@/components/mess-illustrations";
import { APP_NAME, SUPPORT_EMAIL } from "@/lib/app-info";
import { cn } from "@/lib/utils";
import {
  ABOUT_PARAGRAPHS,
  AUDIENCES,
  DAY,
  DISHES,
  FEATURES,
  PRICING,
  PROMISES,
  type Audience,
  type DayMoment,
  type Feature,
} from "./content";
import { ScrollProgress } from "./scroll-progress";
import { SiteFooter, SiteHeader } from "./site-chrome";

// Inherits the site-wide title, description, Open Graph and share poster from
// the root layout. Only the canonical URL is page-specific.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const AUDIENCE_ICONS: Record<Audience["icon"], typeof ChefHat> = {
  GraduationCap,
  ChefHat,
  Store,
};
const FEATURE_ICONS: Record<Feature["icon"], typeof ChefHat> = {
  QrCode,
  Soup,
  ClipboardList,
  CalendarOff,
  Megaphone,
  Receipt,
};
const DAY_ICONS: Record<DayMoment["icon"], typeof ChefHat> = { Sunrise, Soup, House, Moon };
const PROMISE_ICONS = { ShieldCheck, HeartHandshake, Lock, IndianRupee } as const;

/** Small, warm section label — sentence case, not a terminal readout. */
function Kicker({
  children,
  icon: Icon = UtensilsCrossed,
}: {
  children: React.ReactNode;
  icon?: typeof ChefHat;
}) {
  return (
    <span className="text-aurora-1 bg-aurora-1/10 inline-flex w-fit items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-bold">
      <Icon className="size-4" aria-hidden="true" />
      {children}
    </span>
  );
}

function SectionHeading({
  kicker,
  icon,
  title,
  body,
  id,
  center = false,
}: {
  kicker: string;
  icon?: typeof ChefHat;
  title: React.ReactNode;
  body?: string;
  id: string;
  center?: boolean;
}) {
  return (
    <div
      className={cn(
        "mb-12 flex max-w-3xl flex-col gap-4",
        center && "mx-auto items-center text-center",
      )}
    >
      <Kicker {...(icon ? { icon } : {})}>{kicker}</Kicker>
      <h2
        id={id}
        className="text-[clamp(2rem,4vw,3.25rem)] leading-[1.06] font-black tracking-[-0.03em]"
      >
        {title}
      </h2>
      {body ? (
        <p className="text-muted-foreground max-w-[58ch] text-lg leading-relaxed">{body}</p>
      ) : null}
    </div>
  );
}

/** The hero's right side: a steaming thali with the day's mess life floating round it. */
function HeroPlate() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[520px]">
      <div
        aria-hidden="true"
        className="absolute inset-[8%] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, var(--orb-2), transparent 70%)" }}
      />
      <ThaliIllustration className="plate-float relative size-full" />

      {/* Today's menu card */}
      <div className="bg-card/90 absolute top-[4%] -left-2 w-52 rounded-2xl border p-4 shadow-xl backdrop-blur-xl sm:-left-8">
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
          <Soup className="text-chilli size-3.5" aria-hidden="true" /> Today&apos;s lunch
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          <li>Rajma chawal</li>
          <li>Jeera aloo &amp; roti</li>
          <li>Salad &amp; gulab jamun</li>
        </ul>
      </div>

      {/* Served count card */}
      <div className="bg-card/90 absolute right-0 bottom-[10%] w-56 rounded-2xl border p-4 shadow-xl backdrop-blur-xl sm:-right-6">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground font-semibold">Lunch served</span>
          <span className="text-muted-foreground/70 text-[10px]">sample</span>
        </div>
        <p className="font-heading mt-1 text-2xl font-black">
          212 <span className="text-muted-foreground text-base font-bold">of 240</span>
        </p>
        <div className="bg-muted mt-2 h-2 overflow-hidden rounded-full">
          <div className="aurora-fill h-full w-[88%] rounded-full" />
        </div>
      </div>

      {/* A served ping */}
      <div className="bg-card/90 absolute top-[46%] -right-1 flex items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-1.5 text-xs font-semibold shadow-lg backdrop-blur-xl sm:-right-10">
        <span className="bg-leaf flex size-6 items-center justify-center rounded-full text-white">
          <Check className="size-3.5" aria-hidden="true" />
        </span>
        Served · Room 204
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="relative min-h-svh overflow-x-clip">
      <ScrollProgress />
      <AuroraBackdrop />

      <div className="relative z-10">
        <SiteHeader />

        <main>
          {/* ── Hero ─────────────────────────────────────────────── */}
          <section
            aria-labelledby="hero-title"
            className="mx-auto grid max-w-7xl items-center gap-14 px-4 pt-14 pb-16 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20"
          >
            <div className="flex flex-col items-start gap-7">
              <div className="aurora-rise">
                <Kicker icon={ChefHat}>Hostel mess management</Kicker>
              </div>

              <h1
                id="hero-title"
                className="aurora-rise text-[clamp(2.6rem,5.8vw,5rem)] leading-[1.0] font-black tracking-[-0.04em]"
                style={{ animationDelay: ".1s" }}
              >
                Good food, on time, <span className="aurora-text">for every student.</span>
              </h1>

              <p
                className="text-muted-foreground aurora-rise max-w-[54ch] text-lg leading-relaxed"
                style={{ animationDelay: ".2s" }}
              >
                {APP_NAME} runs your hostel mess — the weekly menu, meal plans, a QR meal pass for
                every student and a live count for the kitchen. Shorter queues at the counter, less
                food thrown away.
              </p>

              <div className="aurora-rise flex flex-wrap gap-3" style={{ animationDelay: ".3s" }}>
                <Link
                  href="/login"
                  className="aurora-fill aurora-glow focus-visible:ring-ring/50 inline-flex h-14 items-center gap-2 rounded-full px-8 text-base font-extrabold transition-transform hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:outline-none"
                >
                  Sign in to your mess
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <a
                  href="#day"
                  className="bg-card/70 focus-visible:ring-ring/50 inline-flex h-14 items-center rounded-full border px-8 text-base font-semibold backdrop-blur transition-transform hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:outline-none"
                >
                  See a day at the mess
                </a>
              </div>

              <ul
                className="aurora-rise text-muted-foreground flex flex-wrap gap-x-5 gap-y-2 text-sm"
                style={{ animationDelay: ".4s" }}
              >
                {[
                  "No registers or token slips",
                  "Students & staff use the app",
                  "Set up with you",
                ].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <Check className="text-leaf size-4" aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="aurora-rise" style={{ animationDelay: ".25s" }}>
              <HeroPlate />
            </div>
          </section>

          {/* ── Meal times ───────────────────────────────────────── */}
          <section aria-label="Meal times" className="mx-auto max-w-7xl px-4 pb-16 sm:px-8">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {MEAL_TIMES.map((m) => (
                <MealChip key={m.meal} {...m} />
              ))}
            </div>
            <p className="text-muted-foreground mt-3 text-center text-sm">
              Breakfast to dinner — every meal handled, on your mess&apos;s own timings.
            </p>
          </section>

          {/* ── Dishes marquee ───────────────────────────────────── */}
          <div
            aria-hidden="true"
            className="overflow-hidden border-y py-4"
            style={{ background: "var(--chip)" }}
          >
            <div className="aurora-marquee text-muted-foreground flex w-max text-base font-semibold">
              {[0, 1].map((copy) => (
                <div key={copy} className="flex gap-10 pr-10">
                  {DISHES.map((dish) => (
                    <span key={dish} className="flex items-center gap-10 whitespace-nowrap">
                      {dish}
                      <UtensilsCrossed className="text-turmeric size-4" />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* ── Who it's for ─────────────────────────────────────── */}
          <section
            id="features"
            aria-labelledby="audience-title"
            className="mx-auto max-w-7xl scroll-mt-24 px-4 py-24 sm:px-8"
          >
            <SectionHeading
              id="audience-title"
              kicker="Made for the whole mess"
              title={
                <>
                  One system for the students,{" "}
                  <span className="aurora-text">the kitchen and the office</span>
                </>
              }
              body="A mess works when three groups of people are in sync. MealAdda gives each of them exactly what they need."
            />

            <div className="grid gap-5 lg:grid-cols-3">
              {AUDIENCES.map((a) => {
                const Icon = AUDIENCE_ICONS[a.icon];
                return (
                  <article
                    key={a.who}
                    className="bg-card/80 flex flex-col gap-4 rounded-3xl border p-8 backdrop-blur-xl transition-transform duration-300 hover:-translate-y-1"
                  >
                    <span className="aurora-fill flex size-12 items-center justify-center rounded-2xl">
                      <Icon className="size-6" aria-hidden="true" />
                    </span>
                    <p className="text-aurora-1 text-sm font-bold">{a.who}</p>
                    <h3 className="text-2xl leading-tight font-extrabold tracking-tight">
                      {a.title}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">{a.body}</p>
                    <ul className="mt-auto space-y-2.5 border-t pt-4 text-sm">
                      {a.points.map((p) => (
                        <li key={p} className="flex items-center gap-2.5">
                          <Check className="text-leaf size-4 shrink-0" aria-hidden="true" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>

            <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => {
                const Icon = FEATURE_ICONS[f.icon];
                return (
                  <div
                    key={f.title}
                    className="bg-card/60 flex gap-4 rounded-2xl border p-5 backdrop-blur"
                  >
                    <span className="bg-aurora-1/10 text-aurora-1 flex size-11 shrink-0 items-center justify-center rounded-xl">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="font-heading font-extrabold">{f.title}</h3>
                      <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{f.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── A day at the mess ────────────────────────────────── */}
          <section
            id="day"
            aria-labelledby="day-title"
            className="mx-auto max-w-7xl scroll-mt-24 px-4 pb-24 sm:px-8"
          >
            <div className="bg-card/50 grid items-center gap-12 rounded-[2rem] border p-6 backdrop-blur-xl sm:p-12 lg:grid-cols-[1.15fr_0.85fr]">
              <div>
                <SectionHeading
                  id="day-title"
                  kicker="A day at the mess"
                  icon={Sunrise}
                  title={
                    <>
                      From morning chai{" "}
                      <span className="aurora-text">to the last dinner plate</span>
                    </>
                  }
                />
                <ol className="relative space-y-8 border-l-2 border-dashed pl-8">
                  {DAY.map((d) => {
                    const Icon = DAY_ICONS[d.icon];
                    return (
                      <li key={d.time} className="relative">
                        <span className="aurora-fill absolute top-0 -left-[3.05rem] flex size-9 items-center justify-center rounded-full ring-4 ring-[var(--background)]">
                          <Icon className="size-4" aria-hidden="true" />
                        </span>
                        <p className="text-aurora-1 text-sm font-bold">{d.time}</p>
                        <p className="font-heading mt-0.5 text-xl font-extrabold">{d.title}</p>
                        <p className="text-muted-foreground mt-1 leading-relaxed">{d.body}</p>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="relative flex justify-center py-6">
                <div
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full blur-3xl"
                  style={{ background: "radial-gradient(circle, var(--orb-1), transparent 70%)" }}
                />
                <PhoneMock className="relative rotate-[-3deg]" />
                <ThaliIllustration className="absolute -right-2 -bottom-4 w-36 sm:right-4" />
              </div>
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
              kicker="Pricing"
              icon={IndianRupee}
              center
              title={
                <>
                  Priced for your mess, <span className="aurora-text">not a one-size plan</span>
                </>
              }
              body="Every mess is different — how many students, how many meals, one hostel or several. Tell us about yours and we'll share a quote."
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
                    <span className="aurora-fill absolute top-6 right-6 rounded-full px-3 py-1 text-xs font-bold">
                      Recommended
                    </span>
                  ) : null}
                  <div className="space-y-2">
                    <h3 className="text-2xl font-black tracking-tight">{tier.name}</h3>
                    <p className="text-muted-foreground text-sm">{tier.tagline}</p>
                  </div>
                  <div>
                    <p className="font-heading text-4xl font-black tracking-tight">Talk to us</p>
                    <p className="text-muted-foreground mt-1 text-sm">Quoted per mess</p>
                  </div>
                  <ul className="flex-1 space-y-3 text-sm">
                    {tier.features.map((f) => (
                      <li key={f} className="flex gap-3">
                        <Check className="text-leaf mt-0.5 size-4 shrink-0" aria-hidden="true" />
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
            <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="flex flex-col gap-5">
                <Kicker icon={HeartHandshake}>About us</Kicker>
                <h2
                  id="about-title"
                  className="text-[clamp(2rem,4vw,3.25rem)] leading-[1.06] font-black tracking-[-0.03em]"
                >
                  Built around the mess queue,{" "}
                  <span className="aurora-text">not a spreadsheet</span>
                </h2>
                {ABOUT_PARAGRAPHS.map((text) => (
                  <p
                    key={text.slice(0, 24)}
                    className="text-muted-foreground text-lg leading-relaxed"
                  >
                    {text}
                  </p>
                ))}
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="text-aurora-1 inline-flex w-fit items-center gap-2 font-bold"
                >
                  {SUPPORT_EMAIL}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </a>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {PROMISES.map((p) => {
                  const Icon = PROMISE_ICONS[p.icon];
                  return (
                    <div
                      key={p.title}
                      className="bg-card/80 flex flex-col gap-3 rounded-3xl border p-7 backdrop-blur"
                    >
                      <span className="bg-aurora-1/10 text-aurora-1 flex size-11 items-center justify-center rounded-xl">
                        <Icon className="size-5" aria-hidden="true" />
                      </span>
                      <h3 className="font-heading text-lg font-extrabold">{p.title}</h3>
                      <p className="text-muted-foreground text-sm leading-relaxed">{p.body}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ── Closing CTA ──────────────────────────────────────── */}
          <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-8">
            <div className="bg-card/70 relative grid items-center gap-8 overflow-hidden rounded-[2rem] border p-8 backdrop-blur-xl sm:p-14 lg:grid-cols-[1fr_auto]">
              <div
                aria-hidden="true"
                className="aurora-spin absolute inset-x-[30%] -inset-y-[40%]"
                style={{
                  background:
                    "conic-gradient(from 0deg, transparent, var(--orb-2), transparent 40%)",
                }}
              />
              <div className="relative flex flex-col gap-5">
                <h2 className="max-w-[20ch] text-[clamp(1.9rem,4vw,3.25rem)] leading-[1.06] font-black tracking-[-0.03em]">
                  Ready for a calmer mess tomorrow?
                </h2>
                <p className="text-muted-foreground max-w-[52ch] text-lg leading-relaxed">
                  Mess owners and admins sign in here. Students and counter staff use the {APP_NAME}{" "}
                  app on their phones.
                </p>
                <div className="flex flex-wrap gap-3">
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
              </div>
              <ThaliIllustration className="relative mx-auto hidden w-56 lg:block" />
            </div>
          </section>
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}
