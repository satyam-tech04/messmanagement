import type { Metadata } from "next";
import { pageTitle } from "@/lib/app-info";

/**
 * The privacy policy.
 *
 * Public and unauthenticated on purpose — the App Store and Play Console both
 * require a URL reachable without signing in, and a reviewer will open it before
 * they open the app.
 *
 * Written from what the schema actually holds rather than from a template. The
 * store data-safety forms have to agree with this page, and the fastest way to
 * fail review is a policy that claims less than the app collects.
 *
 * NOTE FOR THE OWNER: this is an accurate description of the system's
 * behaviour, not legal advice. Have a lawyer read it before launch — India's
 * DPDP Act 2023 obligations around children's data are the part most worth a
 * professional opinion, since some students are under 18.
 */
export const metadata: Metadata = {
  title: pageTitle("Privacy"),
  description: "What CampusMeals collects, why, and who can see it.",
};

const UPDATED = "10 September 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="text-muted-foreground space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-10 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="text-muted-foreground text-sm">Last updated {UPDATED}</p>
      </header>

      <p className="text-muted-foreground text-sm leading-relaxed">
        CampusMeals is used by hostel messes to run meal subscriptions and record attendance at the
        counter. Your mess holds your records; we operate the software that stores them. This page
        describes what the app collects and who can see it.
      </p>

      <Section title="What we collect">
        <p>
          <strong className="text-foreground">Your account.</strong> Your name, mobile number, email
          address where one is on file, room and roll number, and — if your mess adds one — a
          photograph used at the counter to check that the person collecting a meal is the person
          the plan belongs to.
        </p>
        <p>
          <strong className="text-foreground">Your meals.</strong> Which meals you were served and
          when, meals you marked yourself out of, your subscription and what was paid for it, and
          any rating or comment you leave about a meal, including a photo if you attach one.
        </p>
        <p>
          <strong className="text-foreground">Nothing else.</strong> The app does not collect your
          location, your contacts, your other apps, or anything you do outside it.
        </p>
      </Section>

      <Section title="Why">
        <p>
          To let you be served at the counter, to let your mess cook the right number of meals, and
          to answer questions about what you paid and what you were served. Attendance records are
          the mess&rsquo;s account of what it provided, so they are kept even after a plan ends.
        </p>
      </Section>

      <Section title="Who can see it">
        <p>
          Only your own mess. Each mess&rsquo;s data is isolated at the database level, and staff
          and administrators of one mess cannot see another&rsquo;s. Within your mess, counter staff
          see your name, photo and whether you may be served; administrators additionally see your
          contact details, plan and history.
        </p>
        <p>
          We do not sell your data, and we do not share it with anyone except the service providers
          who host it — Supabase for the database and Vercel for the application, both of which
          process it on our instructions and nothing more.
        </p>
      </Section>

      <Section title="Students under 18">
        <p>
          Some messes serve students who are under 18. Where the app shows advertising it is
          requested as child-directed and non-personalised for everyone, without exception — because
          the app cannot know any individual student&rsquo;s age, the strictest setting is applied
          to every request. No advertising profile is built, and no advertising identifier is used
          for tracking.
        </p>
      </Section>

      <Section title="How it is protected">
        <p>
          Data is encrypted in transit and at rest. Access is enforced by the database itself rather
          than only by the application, so a fault in one layer does not expose another mess&rsquo;s
          records. Photographs are held in private storage and served only to signed-in members of
          the same mess. Sign-in credentials are stored on your device in the platform&rsquo;s
          secure keystore.
        </p>
      </Section>

      <Section title="How long it is kept">
        <p>
          Account and meal records are kept while you are a member of your mess and afterwards for
          as long as your mess needs them to answer questions about what it served and what was
          paid. Your mess decides that period; ask them.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You can see your own plan, history and absences in the app at any time. To correct your
          name, number or photograph, or to ask for your records to be deleted, speak to your
          mess&rsquo;s office — they administer the account and can act on it directly. If they
          cannot help, contact us at the address below and we will assist them.
        </p>
        <p>
          Deleting your account removes your profile and contact details. Attendance and payment
          records may be retained where your mess needs them for its own accounts, in which case
          they are no longer linked to your contact details.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If this policy changes materially we will update the date above and, where the change
          affects what is collected, tell you in the app.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about your own records go to your mess office first — they hold them. For
          anything about the software itself, write to{" "}
          <a className="text-foreground underline" href="mailto:support@campusmeals.app">
            support@campusmeals.app
          </a>
          .
        </p>
      </Section>
    </main>
  );
}
