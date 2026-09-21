import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";
import { APP_NAME, SUPPORT_EMAIL, pageTitle } from "@/lib/app-info";
import { LegalDocument, type LegalSection } from "../legal-document";

/**
 * The account-deletion URL Play Console's Data safety form asks for.
 *
 * Since D-32 the app itself can start a deletion, so this page leads with that
 * and keeps the email route for someone who can no longer sign in — which is
 * exactly who reads a page like this, including anyone already deleted.
 *
 * Every promise below is now enforced in code: confirming in the app disables
 * the login on the spot, and the mess erases the personal data from
 * /admin/account-deletions. What is kept is kept because attendance and billing
 * rows cascade from the student — so erasure anonymises rather than deletes.
 */
export const metadata: Metadata = {
  title: pageTitle("Delete your account"),
  description: `How to request deletion of your ${APP_NAME} account and personal data, what is deleted and what may be kept.`,
  alternates: { canonical: "/delete-account" },
};

const SUBJECT = `Delete my ${APP_NAME} account`;
const REQUEST_HREF = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(
  "Full name:\nHostel or mess:\nMobile number or email I sign in with:\nRoll number (if any):\n",
)}`;

const SECTIONS: readonly LegalSection[] = [
  {
    id: "request",
    title: "Request deletion",
    body: (
      <>
        <p>
          The quickest way is in the app: open the account menu in the top right, choose{" "}
          <strong>Delete account</strong>, and confirm. You are signed out immediately and your mess
          is told to erase your details.
        </p>
        <p>
          If you can no longer sign in — or you would rather not use the app — use either route
          instead:
        </p>
        <ol>
          <li>
            <strong>Ask your mess office.</strong> Tell them you want your {APP_NAME} account
            deleted. They will close your account and pass the request to us.
          </li>
          <li>
            <strong>Or email us directly</strong> at{" "}
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(SUBJECT)}`}>
              {SUPPORT_EMAIL}
            </a>{" "}
            with the subject “{SUBJECT}”, and include your full name, the name of your hostel or
            mess, the mobile number or email address you sign in with, and your roll number if you
            have one.
          </li>
          <li>
            <strong>We confirm it is you.</strong> So nobody can delete someone else’s account, we
            check the request against your mess’s records and may contact you on your registered
            number or email.
          </li>
          <li>
            <strong>Your account is deleted</strong> within 30 days of confirmation, and we reply to
            tell you it is done.
          </li>
        </ol>
      </>
    ),
  },
  {
    id: "deleted",
    title: "What is deleted",
    body: (
      <ul>
        <li>Your sign-in account and password, so you can no longer sign in.</li>
        <li>Your profile: name, mobile number, email address, room number and roll number.</li>
        <li>Your profile photograph.</li>
        <li>Your meal ratings, comments and any photos you attached to them.</li>
        <li>Sessions and data stored by the app on your device, once you uninstall it.</li>
      </ul>
    ),
  },
  {
    id: "kept",
    title: "What may be kept",
    body: (
      <>
        <p>
          Your mess may need to keep a record of what it served and what was paid, to keep its own
          accounts accurate and to meet legal and tax obligations. Where it does:
        </p>
        <ul>
          <li>
            <strong>Attendance, plan, payment and bill records</strong> may be kept for as long as
            your mess needs them or the law requires, but are{" "}
            <strong>no longer linked to your name or contact details</strong>.
          </li>
          <li>
            <strong>Audit and security logs</strong> may be kept for a limited period to protect the
            Service against fraud and misuse.
          </li>
        </ul>
        <p>
          Anything kept is deleted once it is no longer needed. See our{" "}
          <Link href="/privacy#retention">Privacy Policy</Link> for details.
        </p>
      </>
    ),
  },
  {
    id: "partial",
    title: "Delete only some data",
    body: (
      <p>
        You do not have to close your account to remove some information. Ask your mess office, or
        email us, to remove your profile photograph, delete a meal rating or photo you submitted, or
        correct your details — and keep using {APP_NAME}.
      </p>
    ),
  },
];

export default function DeleteAccountPage() {
  return (
    <LegalDocument
      eyebrow={`${APP_NAME} account`}
      title={
        <>
          Delete your <span className="aurora-text">account</span>
        </>
      }
      lead={`How to have your ${APP_NAME} account and personal data deleted, what is removed, and what may be kept.`}
      sections={SECTIONS}
    >
      <div className="mt-10 flex flex-wrap items-center gap-4 border-t pt-8">
        <a
          href={REQUEST_HREF}
          className="aurora-fill aurora-glow focus-visible:ring-ring/50 inline-flex h-12 items-center gap-2 rounded-full px-7 text-sm font-extrabold transition-transform hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:outline-none"
        >
          <Mail className="size-4" aria-hidden="true" />
          Email a deletion request
        </a>
        <p className="text-muted-foreground text-sm">
          Opens your email app with the details to fill in.
        </p>
      </div>
    </LegalDocument>
  );
}
