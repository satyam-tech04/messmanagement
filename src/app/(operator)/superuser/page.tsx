import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowRightLeft, ChefHat, HandPlatter, QrCode, Store } from "lucide-react";
import { AuroraEyebrow } from "@/components/aurora-backdrop";
import { OPERATOR_PERSONAS, type OperatorPersona } from "@/core/policies/operator-access.policy";
import { requireSessionUser } from "@/infra/auth/session";
import { pageTitle } from "@/lib/app-info";

export const metadata: Metadata = { title: pageTitle("Choose how to work") };

// Which mess the operator is in is the whole context of this screen.
export const dynamic = "force-dynamic";

const COPY: Record<
  OperatorPersona,
  {
    title: string;
    tag: string;
    body: string;
    points: readonly string[];
    Icon: typeof Store;
    cta: string;
  }
> = {
  ADMIN: {
    title: "Mess admin",
    tag: "Run the mess office",
    body: "The office view: students, plans, menus, attendance, reports and settings — exactly what this mess's own admin sees.",
    points: ["Students & subscriptions", "Week menu planner", "Headcount & reports"],
    Icon: Store,
    cta: "Open admin",
  },
  STAFF: {
    title: "Counter staff",
    tag: "Serve at the counter",
    body: "The serving line: scan signed QR codes, fall back to manual entry, watch the live count and ring up counter sales.",
    points: ["QR scanner", "Manual entry fallback", "Live meal count"],
    Icon: HandPlatter,
    cta: "Open counter",
  },
  STUDENT: {
    title: "Student",
    tag: "See a student's day",
    body: "Enter a real student's account to see their QR, menu and plan exactly as they do. Every entry and exit is audited.",
    points: ["Rotating meal QR", "Today's menu", "Plan & absences"],
    Icon: QrCode,
    cta: "Choose a student",
  },
};

export default async function SuperuserPage() {
  const user = await requireSessionUser();
  const firstName = user.fullName.split(" ")[0] ?? "there";

  return (
    <div className="space-y-12">
      <section className="aurora-rise flex flex-col items-start gap-5">
        <AuroraEyebrow pulse>Platform admin</AuroraEyebrow>
        <h1 className="max-w-3xl text-4xl leading-[1.02] font-black tracking-[-0.035em] sm:text-6xl">
          Welcome back, {firstName}.{" "}
          <span className="aurora-text">Which side of the mess today?</span>
        </h1>
        <p className="text-muted-foreground max-w-2xl text-base leading-relaxed sm:text-lg">
          {/* A template string, not JSX text: the space after an expression in a
              multi-line text node holding an HTML entity was dropped at build
              time ("Demo Hostelthrough"). */}
          {`Pick a persona to see ${user.tenantName} through that role’s eyes. You can come back here any time from the sidebar.`}
        </p>

        <div className="aurora-chip flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
          <ChefHat className="text-aurora-1 size-5" aria-hidden="true" />
          <div className="text-sm">
            <span className="text-muted-foreground">Current mess · </span>
            <span className="font-semibold">{user.tenantName}</span>
            <span className="text-muted-foreground font-mono text-xs"> ({user.tenantSlug})</span>
          </div>
          <Link
            href="/admin/messes"
            className="text-aurora-1 hover:text-foreground inline-flex items-center gap-1.5 text-sm font-semibold transition-colors"
          >
            <ArrowRightLeft className="size-3.5" aria-hidden="true" />
            Change mess
          </Link>
        </div>
      </section>

      <section aria-label="Personas" className="grid gap-5 md:grid-cols-3">
        {OPERATOR_PERSONAS.map(({ persona, href }, index) => {
          const { title, tag, body, points, Icon, cta } = COPY[persona];
          return (
            <Link
              key={persona}
              href={href}
              className="group bg-card/70 hover:border-aurora-1/60 focus-visible:ring-ring/50 aurora-rise relative flex flex-col gap-5 overflow-hidden rounded-3xl border p-7 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 focus-visible:ring-[3px] focus-visible:outline-none"
              style={{ animationDelay: `${0.1 + index * 0.08}s` }}
            >
              <span
                aria-hidden="true"
                className="aurora-sweep absolute top-0 left-0 h-0.5 w-2/5"
                style={{
                  background: "linear-gradient(90deg, transparent, var(--aurora-1), transparent)",
                  animationDelay: `${index * 1.2}s`,
                }}
              />
              <div className="flex items-center justify-between">
                <span className="aurora-fill aurora-glow flex size-12 items-center justify-center rounded-2xl">
                  <Icon className="size-6" aria-hidden="true" />
                </span>
                <span className="text-muted-foreground text-xs font-semibold">{tag}</span>
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
              </div>
              <ul className="space-y-2 text-sm">
                {points.map((p) => (
                  <li key={p} className="flex gap-2.5">
                    <span className="text-aurora-1" aria-hidden="true">
                      ▸
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
              <span className="text-aurora-1 mt-auto inline-flex items-center gap-2 pt-2 text-sm font-bold">
                {cta}
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </span>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
