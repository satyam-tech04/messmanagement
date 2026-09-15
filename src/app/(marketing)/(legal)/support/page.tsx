import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, Mail } from "lucide-react";
import { APP_NAME, SUPPORT_EMAIL, pageTitle } from "@/lib/app-info";
import { LegalDocument, type LegalSection } from "../legal-document";

/**
 * The Support URL App Store Connect requires. A reviewer checks that it leads
 * somewhere a user could actually get help, so it names a contact and answers
 * the questions the counter really gets asked.
 */
export const metadata: Metadata = {
  title: pageTitle("Support"),
  description: `Get help with ${APP_NAME}: signing in, your QR meal pass, plans, payments and your account.`,
  alternates: { canonical: "/support" },
};

const FAQ: ReadonlyArray<{ q: string; a: React.ReactNode }> = [
  {
    q: "I can’t sign in.",
    a: (
      <>
        Students sign in to the {APP_NAME} app with the mobile number registered with their mess;
        staff and administrators use their email address. Your first password comes from your mess,
        and you are asked to choose your own the first time you sign in. If you have forgotten it,
        your mess office can reset it.
      </>
    ),
  },
  {
    q: "My QR code says I can’t be served.",
    a: (
      <>
        The screen shows why — for example no running plan, a meal you marked yourself out of, or a
        meal outside its serving time. Plans and payments are managed by your mess, so speak to the
        mess office. Counter staff can also record your meal manually.
      </>
    ),
  },
  {
    q: "Can I use a screenshot of my QR code?",
    a: (
      <>
        No. The code refreshes itself while it is on screen, each one expires within seconds, and it
        is checked by our server — so a screenshot or a code forwarded to someone else is refused at
        the counter.
      </>
    ),
  },
  {
    q: "I think I was charged or marked incorrectly.",
    a: (
      <>
        Every plan, payment, absence and served meal is recorded with a date and time. Your mess
        office can look up the exact record and correct it. Refunds are handled by your mess under
        its own policy.
      </>
    ),
  },
  {
    q: "How do I delete my account?",
    a: (
      <>
        Ask your mess office, or follow the steps on{" "}
        <Link href="/delete-account">Delete your account</Link>.
      </>
    ),
  },
];

const SECTIONS: readonly LegalSection[] = [
  {
    id: "contact",
    title: "Contact us",
    body: (
      <>
        <p>
          Most questions are answered fastest by <strong>your mess office</strong> — they run your
          account, your plan and the counter. For anything about the {APP_NAME} app itself, write to
          us and include your mess name and the mobile number or email you sign in with.
        </p>
        <p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="aurora-chip text-foreground! inline-flex items-center gap-2 rounded-full px-5 py-2.5 no-underline!"
          >
            <Mail className="text-aurora-1 size-4" aria-hidden="true" />
            {SUPPORT_EMAIL}
          </a>
        </p>
      </>
    ),
  },
  {
    id: "faq",
    title: "Common questions",
    body: (
      <div className="flex flex-col gap-3">
        {FAQ.map((item) => (
          <details
            key={item.q}
            className="group bg-background/60 rounded-2xl border px-5 open:pb-4"
          >
            <summary className="text-foreground focus-visible:ring-ring/50 flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl py-4 font-semibold focus-visible:ring-[3px] focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown
                className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    ),
  },
  {
    id: "legal",
    title: "Privacy and terms",
    body: (
      <p>
        Read how we handle your data in our <Link href="/privacy">Privacy Policy</Link>, and the
        rules for using {APP_NAME} in our <Link href="/terms">Terms &amp; Conditions</Link>.
      </p>
    ),
  },
];

export default function SupportPage() {
  return (
    <LegalDocument
      eyebrow="Help"
      title={
        <>
          How can we <span className="aurora-text">help?</span>
        </>
      }
      lead={`Signing in, your QR meal pass, plans, payments and your ${APP_NAME} account.`}
      sections={SECTIONS}
    />
  );
}
