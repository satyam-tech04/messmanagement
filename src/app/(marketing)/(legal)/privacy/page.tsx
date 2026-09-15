import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME, SUPPORT_EMAIL, pageTitle } from "@/lib/app-info";
import { LegalDocument, LegalTable, type LegalSection } from "../legal-document";

/**
 * The privacy policy — the URL both app stores link to.
 *
 * Written from what the schema and the app actually do, not from a template:
 * the store data-safety forms must agree with this page, and a policy that
 * claims less than the app collects is the fastest way to fail review. If a
 * feature starts collecting something new (an ads SDK, analytics, location),
 * this page changes in the same commit. docs/RELEASE-MOBILE.md lists the store
 * answers that have to match it.
 *
 * Not legal advice — have a lawyer read it, especially "Students under 18"
 * (India's DPDP Act, 2023).
 */
export const metadata: Metadata = {
  title: pageTitle("Privacy Policy"),
  description: `What ${APP_NAME} collects, why, who can see it, how long it is kept and the choices you have.`,
  alternates: { canonical: "/privacy" },
};

const mail = <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;

const SECTIONS: readonly LegalSection[] = [
  {
    id: "who-we-are",
    title: "Who we are",
    body: (
      <>
        <p>
          {APP_NAME} (“<strong>{APP_NAME}</strong>”, “<strong>we</strong>”, “<strong>us</strong>”)
          provides software that hostel messes use to run meal subscriptions, verify attendance at
          the serving counter with a QR code, publish menus, and record counter sales. {APP_NAME} is
          available as a mobile app for iOS and Android and on the web at mealadda.in.
        </p>
        <p>
          The hostel or mess that registered you (“<strong>your mess</strong>”) decides what
          information it records about its students and staff and what it is used for. We store and
          process that information on your mess’s behalf and on its instructions. This policy
          explains what the software collects and how we handle it; your mess may have its own
          policies as well.
        </p>
        <p>
          This policy applies to the {APP_NAME} app, the web console and this website. By using{" "}
          {APP_NAME} you acknowledge this policy and our{" "}
          <Link href="/terms">Terms &amp; Conditions</Link>.
        </p>
      </>
    ),
  },
  {
    id: "what-we-collect",
    title: "What we collect",
    body: (
      <>
        <p>
          Accounts are created by your mess — you cannot sign up by yourself. The information below
          comes from your mess, from you, or is recorded when you use the app.
        </p>
        <LegalTable
          columns={["Category", "What it includes", "Comes from"]}
          rows={[
            [
              "Identity and contact",
              "Name, mobile number, email address (where one is on file), roll number and room number.",
              "Your mess",
            ],
            [
              "Photograph",
              "A profile photo, if your mess adds one, shown to counter staff so they can confirm the person collecting a meal is the plan holder.",
              "Your mess",
            ],
            [
              "Sign-in details",
              "Your password (stored only as a secure one-way hash) and session tokens.",
              "You and your mess",
            ],
            [
              "Plan and payments",
              "Your subscription plan, its dates and price, what was paid and whether anything is outstanding, and counter bills recorded against you.",
              "Your mess",
            ],
            [
              "Meal activity",
              "Which meals you were served and when, how each was verified (QR scan or manual entry), meals you marked yourself out of, and pauses to your plan.",
              "Recorded as you use the service",
            ],
            [
              "Feedback",
              "Ratings and comments you leave about a meal, and a photo if you choose to attach one (only where your mess has turned feedback on).",
              "You",
            ],
            [
              "Staff and admin activity",
              "For staff and administrators: actions such as scans, manual entries, plan changes and bills, recorded in an audit log with the time and your account.",
              "Recorded as you use the service",
            ],
            [
              "Technical data",
              "Standard server logs — IP address, device and browser type, time of request and errors — kept by our hosting providers for security and troubleshooting.",
              "Your device",
            ],
          ]}
        />
        <h3>What we do not collect</h3>
        <p>
          {APP_NAME} does <strong>not</strong> collect your precise or approximate location, your
          contacts, photos from your gallery that you have not chosen to attach, your browsing
          history, information from other apps, advertising identifiers, or any health or biometric
          data. We do not use analytics or crash-reporting tools that send your activity to third
          parties.
        </p>
      </>
    ),
  },
  {
    id: "device",
    title: "On your device",
    body: (
      <ul>
        <li>
          <strong>Camera.</strong> The app asks for camera access only so counter staff can scan
          students’ meal codes. Camera images are processed on the device to read the code and are
          not stored or uploaded. You can revoke this permission in your phone’s settings at any
          time.
        </li>
        <li>
          <strong>Secure storage.</strong> Your sign-in session is kept in your phone’s secure
          keystore (Keychain on iOS, Keystore on Android) so you stay signed in.
        </li>
        <li>
          <strong>Local preferences.</strong> Small settings, such as light or dark theme, are
          stored on your device. On a staff device, scans made while the connection drops are held
          briefly on the device and sent as soon as it reconnects.
        </li>
        <li>
          <strong>Screen brightness.</strong> The app raises screen brightness while your QR code is
          displayed so the scanner can read it, and restores it afterwards.
        </li>
        <li>
          <strong>Cookies.</strong> The website uses only essential cookies to keep you signed in,
          and local storage for your theme choice. It does not use advertising or analytics cookies.
        </li>
      </ul>
    ),
  },
  {
    id: "why",
    title: "Why we use it",
    body: (
      <>
        <ul>
          <li>To sign you in and keep your account secure.</li>
          <li>
            To confirm, at the counter, that you have a valid plan for the meal being served, and to
            record that you were served.
          </li>
          <li>To let your mess plan meals and cook the right quantity from a live headcount.</li>
          <li>To apply absences, pauses and plan changes according to your mess’s rules.</li>
          <li>
            To keep an accurate record of plans, payments and meals, so questions about what was
            paid and served can be answered.
          </li>
          <li>
            To show you menus and announcements from your mess, and to pass your meal feedback to
            your mess.
          </li>
          <li>To prevent misuse, such as shared or copied QR codes, and to investigate errors.</li>
          <li>To comply with the law and respond to lawful requests.</li>
        </ul>
        <p>
          We process this information to provide the service your mess has arranged for you, on the
          basis of the consent given to your mess when you were registered. We do not use it for any
          unrelated purpose, and we do not use it to profile you.
        </p>
      </>
    ),
  },
  {
    id: "who-can-see-it",
    title: "Who can see it",
    body: (
      <>
        <p>
          <strong>Only your own mess.</strong> Each mess’s data is separated at the database level:
          staff and administrators of one mess cannot see another mess’s records. Within your mess:
        </p>
        <ul>
          <li>
            <strong>Counter staff</strong> see your name, photo, roll number and whether you may be
            served for the current meal.
          </li>
          <li>
            <strong>Administrators</strong> additionally see your contact details, plan, payments,
            absences, feedback and meal history.
          </li>
          <li>
            <strong>You</strong> see your own plan, QR code, menu, absences and history.
          </li>
        </ul>
        <p>
          A small number of {APP_NAME} personnel can access data when it is needed to support your
          mess, fix a problem or keep the service secure — including, when a mess asks for help,
          viewing the app as a particular student sees it. Every such session is recorded in your
          mess’s audit log.
        </p>
        <p>
          <strong>We do not sell, rent or trade personal data</strong>, and we do not share it with
          advertisers or data brokers. We disclose information only to the service providers below,
          where required by law, to protect someone’s safety, or as part of a merger or transfer of
          the business under the same protections described here.
        </p>
      </>
    ),
  },
  {
    id: "service-providers",
    title: "Service providers",
    body: (
      <>
        <p>
          We use a small number of providers who process data on our instructions and nothing more:
        </p>
        <LegalTable
          columns={["Provider", "Purpose"]}
          rows={[
            ["Supabase", "Database, sign-in and private file storage, including photos."],
            ["Vercel", "Hosting this website, the web console and the app’s server endpoints."],
            [
              "Apple App Store and Google Play",
              "Distributing the app. Their own privacy policies cover what they collect when you download it.",
            ],
          ]}
        />
        <p>
          These providers may store and process data on servers outside India. Where they do, the
          data stays protected by encryption and contractual safeguards, and we transfer it only as
          applicable law permits.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Students under 18",
    body: (
      <>
        <p>
          Some messes serve students who are under 18. {APP_NAME} is not directed at children, and
          accounts are created only by a mess, never by a child signing up. Where a mess registers a
          student under 18, the mess is responsible for obtaining consent from that student’s parent
          or guardian as required by law, including India’s Digital Personal Data Protection Act,
          2023.
        </p>
        <p>
          We do not track students, build behavioural profiles, or show them targeted advertising.
          Because the app cannot know any individual student’s age, these protections apply to{" "}
          <strong>every</strong> user without exception. A parent or guardian can ask for a child’s
          information to be reviewed, corrected or deleted by writing to {mail}.
        </p>
      </>
    ),
  },
  {
    id: "advertising",
    title: "Advertising and tracking",
    body: (
      <>
        <p>
          {APP_NAME} does not show advertising and does not track you across other companies’ apps
          or websites. It does not use an advertising identifier.
        </p>
        <p>
          If we ever introduce advertising, it will be requested as child-directed and
          non-personalised for every user, and we will update this policy and tell you in the app
          before it starts.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "How it is protected",
    body: (
      <>
        <ul>
          <li>Data is encrypted in transit (HTTPS) and at rest.</li>
          <li>
            Access rules are enforced by the database itself, not only by the app, so a fault in one
            layer does not expose another mess’s records.
          </li>
          <li>
            Photographs are held in private storage and served only to signed-in members of the same
            mess.
          </li>
          <li>
            QR codes are signed by our server and expire within seconds, so they cannot be forged,
            copied or reused.
          </li>
          <li>Passwords are stored only as secure hashes; nobody, including us, can read them.</li>
          <li>Sensitive staff and administrator actions are recorded in an audit log.</li>
        </ul>
        <p>
          No system is perfectly secure. If a breach affecting your personal data occurs, we will
          notify your mess, the relevant authorities and, where required, you, as the law requires.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long it is kept",
    body: (
      <>
        <p>
          We keep your account information while you are a member of your mess. After that, records
          are kept only as long as your mess needs them to answer questions about what it served and
          what was paid, or as long as the law requires (for example, for accounting). Attendance
          and payment records are the mess’s account of what it provided, so they may be kept after
          a plan ends.
        </p>
        <p>
          When a record no longer needs to be kept, it is deleted or anonymised so it can no longer
          be linked to you. Server logs are kept by our hosting providers for a limited period and
          then deleted.
        </p>
      </>
    ),
  },
  {
    id: "your-rights",
    title: "Your rights and choices",
    body: (
      <>
        <p>Subject to applicable law, you have the right to:</p>
        <ul>
          <li>
            <strong>Access</strong> — see your plan, absences and meal history in the app, and ask
            for a copy of the personal data held about you.
          </li>
          <li>
            <strong>Correction</strong> — ask for your name, number, photograph or other details to
            be corrected or updated.
          </li>
          <li>
            <strong>Deletion</strong> — ask for your account and personal data to be erased. See{" "}
            <Link href="/delete-account">how to delete your account</Link>.
          </li>
          <li>
            <strong>Withdraw consent</strong> — your account can then no longer be used to collect
            meals, and it will be closed.
          </li>
          <li>
            <strong>Grievance redressal</strong> — raise a complaint with us and get a response,
            and, if it is not resolved, escalate to the Data Protection Board of India.
          </li>
          <li>
            <strong>Nominate</strong> — name someone to exercise these rights for you in the event
            of death or incapacity.
          </li>
        </ul>
        <p>
          Your mess administers your account, so it can usually act fastest — speak to your mess
          office first. If they cannot help, or you would rather contact us directly, write to{" "}
          {mail}. We verify the request with your mess and respond within 30 days.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        We may update this policy as the service changes. The effective date at the top of this page
        shows when it last changed. If a change materially affects what we collect or how it is
        used, we will tell you in the app before it takes effect.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact and grievances",
    body: (
      <p>
        Questions about your own records are best answered by your mess office, which holds them.
        For anything about {APP_NAME}, privacy requests, or to raise a grievance, contact our
        Grievance Officer at {mail}. Please include your name, your mess, and the mobile number or
        email you sign in with.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      eyebrow="Legal"
      title={
        <>
          Privacy <span className="aurora-text">Policy</span>
        </>
      }
      lead={`What ${APP_NAME} collects, why, who can see it, and the choices you have.`}
      effective="15 September 2026"
      summary={[
        `Your mess holds your records. ${APP_NAME} is the software it uses to run meals.`,
        "We collect what is needed to serve you at the counter — no location, no contacts.",
        "Only your own mess can see your data. We never sell it.",
        "No ads, no advertising identifiers, no third-party tracking.",
        "You can ask for your data to be corrected or deleted at any time.",
      ]}
      sections={SECTIONS}
    />
  );
}
