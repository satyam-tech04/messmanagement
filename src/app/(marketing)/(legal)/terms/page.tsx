import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME, SUPPORT_EMAIL, pageTitle } from "@/lib/app-info";
import { LegalDocument, type LegalSection } from "../legal-document";

/**
 * Terms & Conditions for students, counter staff and mess administrators.
 *
 * The line this document holds throughout: the mess provides the food, sets the
 * plans and prices and takes the money; MealAdda provides the software. Every
 * clause about meals, refunds and allergies points back to the mess for that
 * reason.
 *
 * Not legal advice — the liability cap and the governing-law clause in
 * particular want a lawyer's eye before launch.
 */
export const metadata: Metadata = {
  title: pageTitle("Terms & Conditions"),
  description: `The terms for using ${APP_NAME} as a student, counter staff member or mess administrator.`,
  alternates: { canonical: "/terms" },
};

const SECTIONS: readonly LegalSection[] = [
  {
    id: "acceptance",
    title: "Acceptance",
    body: (
      <>
        <p>
          These Terms &amp; Conditions (“<strong>Terms</strong>”) govern your use of the {APP_NAME}{" "}
          mobile app, website, web console and related services (together, the “
          <strong>Service</strong>”), provided by {APP_NAME} (“<strong>we</strong>”, “
          <strong>us</strong>”). By signing in to or using the Service, you agree to these Terms and
          to our <Link href="/privacy">Privacy Policy</Link>. If you do not agree, do not use the
          Service.
        </p>
        <p>
          If you are under 18, you may use the Service only with the involvement of a parent or
          guardian, who accepts these Terms on your behalf through your mess’s registration process.
        </p>
      </>
    ),
  },
  {
    id: "service",
    title: "The service",
    body: (
      <>
        <p>
          {APP_NAME} is software that hostels and messes (“<strong>messes</strong>”) use to manage
          meal subscriptions, verify attendance at the serving counter using a rotating QR code,
          publish menus and announcements, handle absences, record counter sales, and see live
          headcounts.
        </p>
        <p>
          <strong>We are a technology provider, not a food provider.</strong> Your mess operates the
          kitchen, serves the meals, sets its plans, prices and rules, and collects payment. Your
          agreement for meals is with your mess. {APP_NAME} is not a party to that agreement and is
          not responsible for the mess’s food, service or conduct.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Your account",
    body: (
      <ul>
        <li>
          Accounts are created by your mess. Students sign in with the mobile number registered with
          their mess; staff and administrators sign in with their email address.
        </li>
        <li>
          You will be asked to replace your initial password the first time you sign in. Keep your
          password private and do not let anyone else use your account.
        </li>
        <li>
          You are responsible for activity on your account. Tell your mess office straight away if
          you think someone else has used it, so the password can be reset.
        </li>
        <li>
          Make sure the details your mess holds about you are accurate, and ask your mess to correct
          them if they are not.
        </li>
      </ul>
    ),
  },
  {
    id: "plans",
    title: "Plans and meals",
    body: (
      <ul>
        <li>
          Your mess assigns your subscription plan. The plan states its dates, the meals it covers
          and its price. The price is fixed when the plan is assigned to you, so later changes to
          the mess’s price list do not change a plan you already hold.
        </li>
        <li>
          A plan entitles you to one serving of each covered meal on each day of the plan, collected
          in person during that meal’s serving time. A meal that is not collected is not carried
          forward unless your mess’s absence rules say otherwise.
        </li>
        <li>When your plan ends, you cannot be served until your mess assigns a new one.</li>
        <li>
          Serving times, the meals offered and the menu are decided by your mess and may change.
        </li>
      </ul>
    ),
  },
  {
    id: "qr",
    title: "QR codes and the counter",
    body: (
      <ul>
        <li>
          Your QR code is personal to you. It refreshes automatically, expires within seconds and is
          verified by our server. Screenshots, photos and codes forwarded to someone else will be
          refused.
        </li>
        <li>
          Counter staff may compare you with your profile photo. They may refuse a meal if your code
          cannot be verified, your plan does not cover the meal, the meal has already been served to
          you, or it is outside serving time.
        </li>
        <li>
          If the connection is down or a code cannot be checked, staff may record your meal
          manually. Manual entries are logged against the staff member who made them.
        </li>
        <li>
          Each meal can be recorded only once per student. Scanning twice does not use up two meals.
        </li>
      </ul>
    ),
  },
  {
    id: "absences",
    title: "Absences and pauses",
    body: (
      <p>
        Where your mess allows it, you may mark yourself out of upcoming meals or ask for your plan
        to be paused. Requests must be made before the cut-off time your mess sets, may need your
        mess’s approval, and are applied according to your mess’s rules. Whether a missed meal is
        credited, and how much, is decided by your mess’s policy. A meal marked as an absence cannot
        then be collected at the counter.
      </p>
    ),
  },
  {
    id: "payments",
    title: "Payments and refunds",
    body: (
      <ul>
        <li>
          <strong>You pay your mess, not {APP_NAME}.</strong> Plans and counter bills are paid to
          your mess by whatever means it accepts. {APP_NAME} does not process, hold or receive your
          payments.
        </li>
        <li>
          The Service records what your mess tells it about plans, payments and bills. If you
          believe a record is wrong, raise it with your mess office, which can check and correct it.
        </li>
        <li>
          Refunds, credits for missed meals, pro-rated charges and any dispute about money are
          between you and your mess, under your mess’s own policy.
        </li>
        <li>The {APP_NAME} app is free to download. We do not charge students for using it.</li>
      </ul>
    ),
  },
  {
    id: "food",
    title: "Food, menus and allergies",
    body: (
      <p>
        Menus in the app are published by your mess and are for information only. {APP_NAME} does
        not prepare, handle, inspect or deliver food and makes no statement about ingredients,
        allergens, nutrition, hygiene or quality.{" "}
        <strong>
          If you have an allergy or dietary requirement, confirm it directly with your mess before
          eating.
        </strong>{" "}
        Concerns about food safety should be raised with your mess and, where appropriate, the
        relevant authorities.
      </p>
    ),
  },
  {
    id: "feedback",
    title: "Feedback and content",
    body: (
      <>
        <p>
          Where your mess has turned it on, you can rate meals and add comments or photos. You keep
          ownership of what you submit, and you allow your mess and {APP_NAME} to store it, show it
          to your mess’s administrators and use it to improve the food and the Service.
        </p>
        <p>Anything you submit must be honest and must not:</p>
        <ul>
          <li>be abusive, threatening, obscene, discriminatory or defamatory;</li>
          <li>include photographs of other people without their permission;</li>
          <li>contain someone else’s personal information; or</li>
          <li>infringe anyone’s rights or break the law.</li>
        </ul>
        <p>Your mess or {APP_NAME} may remove content that breaks these rules.</p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <>
        <p>You agree not to:</p>
        <ul>
          <li>
            share, copy, forge or replay a QR code, or help anyone collect a meal they are not
            entitled to;
          </li>
          <li>use another person’s account, or let someone use yours;</li>
          <li>try to access data belonging to another student or another mess;</li>
          <li>
            probe, scan, disrupt or overload the Service, or bypass its security or access controls;
          </li>
          <li>
            reverse-engineer, decompile or modify the app, except where the law expressly allows it;
          </li>
          <li>use bots, scripts or automated means to access the Service; or</li>
          <li>use the Service for anything unlawful, fraudulent or harmful.</li>
        </ul>
        <p>
          Misuse may lead to your account being suspended and may be reported to your mess, which
          may take its own action.
        </p>
      </>
    ),
  },
  {
    id: "messes",
    title: "Messes, staff and administrators",
    body: (
      <>
        <p>If you use {APP_NAME} on behalf of a mess, you also agree that:</p>
        <ul>
          <li>
            you will use students’ personal data only to run the mess, and keep it confidential;
          </li>
          <li>
            the mess has a lawful basis for the data it enters, including consent from students —
            and from a parent or guardian for students under 18 — for their details and photographs;
          </li>
          <li>
            you will keep plans, prices, payment records and menus accurate, and correct errors
            promptly;
          </li>
          <li>you will record manual entries, bills and payments truthfully;</li>
          <li>
            you will keep staff accounts individual, and remove access for anyone who leaves; and
          </li>
          <li>
            you will pass on to us any request from a student to access, correct or delete their
            data that you cannot handle yourselves.
          </li>
        </ul>
        <p>
          Commercial terms between {APP_NAME} and a mess, such as fees, are agreed separately. Where
          they conflict with these Terms, the separate agreement applies to the mess.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    title: "Availability",
    body: (
      <>
        <p>
          We work to keep {APP_NAME} available and reliable, especially around meal times, but we
          cannot promise it will always be uninterrupted or error-free. It depends on internet
          connections, devices and third-party providers outside our control. We may carry out
          maintenance, and we may change, add or remove features. Messes should keep a manual way of
          recording meals in case the Service is unavailable.
        </p>
        <p>Keep the app up to date. Older versions may stop working when the Service changes.</p>
      </>
    ),
  },
  {
    id: "ip",
    title: "Intellectual property",
    body: (
      <>
        <p>
          The Service, including the app, its design and the {APP_NAME} name and logo, is owned by{" "}
          {APP_NAME} and protected by law. We give you a personal, non-exclusive, non-transferable,
          revocable licence to use the app for its intended purpose while you have an account.
          Messes keep their own names, logos and content.
        </p>
        <p>
          If you downloaded the app from the Apple App Store, Apple’s standard Licensed Application
          End User License Agreement also applies, and Apple has no obligation to provide support or
          maintenance for the app. If you downloaded it from Google Play, Google Play’s terms also
          apply.
        </p>
      </>
    ),
  },
  {
    id: "termination",
    title: "Suspension and closure",
    body: (
      <ul>
        <li>
          Your mess may deactivate your account, for example when you leave the hostel or your plan
          ends.
        </li>
        <li>
          We may suspend or close an account that breaks these Terms, puts the Service or other
          users at risk, or where the law requires us to. Where appropriate we will tell your mess
          first.
        </li>
        <li>
          You may stop using the Service at any time and ask for your account to be deleted — see{" "}
          <Link href="/delete-account">how to delete your account</Link>.
        </li>
        <li>
          When an account is closed, records may be kept as described in our{" "}
          <Link href="/privacy#retention">Privacy Policy</Link>. Parts of these Terms that by their
          nature should continue — such as payments, disclaimers and liability — continue to apply.
        </li>
      </ul>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <p>
        To the extent permitted by law, the Service is provided “as is” and “as available”. We give
        no warranty that it will meet every need, and we are not responsible for the food, service,
        pricing, refunds, decisions or conduct of any mess or its staff. Nothing in these Terms
        limits any rights you have under the Consumer Protection Act, 2019 or other laws that cannot
        be excluded.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <p>
        To the extent permitted by law, {APP_NAME} is not liable for any indirect, incidental,
        special or consequential loss, or for loss of data, profit or goodwill, arising from your
        use of or inability to use the Service. Our total liability to a student for any claim
        relating to the Service is limited to ₹1,000. Nothing in these Terms limits liability for
        fraud, for death or personal injury caused by our negligence, or any other liability that
        cannot be limited by law.
      </p>
    ),
  },
  {
    id: "law",
    title: "Governing law and disputes",
    body: (
      <p>
        These Terms are governed by the laws of India. Please contact us first so we can try to
        resolve any concern informally. If a dispute cannot be resolved, it will be subject to the
        jurisdiction of the competent courts in India, without affecting any right you have to bring
        a consumer complaint where you live.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <>
        <p>
          We may update these Terms as the Service changes. The effective date at the top shows when
          they last changed. If a change is significant, we will tell you in the app before it takes
          effect. Continuing to use the Service after that means you accept the updated Terms.
        </p>
        <p>If any part of these Terms is found unenforceable, the rest continues to apply.</p>
      </>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        For questions about your plan, meals, payments or refunds, contact your mess office. For
        questions about these Terms or the {APP_NAME} app, write to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      eyebrow="Legal"
      title={
        <>
          Terms &amp; <span className="aurora-text">Conditions</span>
        </>
      }
      lead={`The rules for using ${APP_NAME} as a student, counter staff member or mess administrator.`}
      effective="15 September 2026"
      summary={[
        `Your mess provides the food and sets the plans, prices and rules. ${APP_NAME} provides the software.`,
        "Your account and QR code are for you alone. Sharing or copying them is not allowed.",
        "Payments are made to your mess, and questions about charges or refunds go to your mess.",
        "Allergy and dietary questions go to your mess — we do not prepare food.",
      ]}
      sections={SECTIONS}
    />
  );
}
