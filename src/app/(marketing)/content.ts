/**
 * Everything the landing page says, in one file.
 *
 * Kept as data so copy can be edited without touching layout, and so a claim
 * can be checked against the product in one place. Every figure here is a
 * real default or behaviour of the shipped code — the QR rotates every 15s
 * (`tenant_settings.qr_refresh_seconds`), tokens are HMAC-SHA256 signed, the
 * counter queues scans offline. Pricing deliberately names no numbers until
 * they are decided.
 */
export const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#about", label: "About us" },
] as const;

export const HERO_STATS = [
  { value: "15s", label: "QR ROTATION" },
  { value: "HMAC", label: "SIGNED EVERY SCAN" },
  { value: "Offline", label: "COUNTER QUEUE" },
  { value: "3 apps", label: "STUDENT · COUNTER · ADMIN" },
] as const;

export const MARQUEE = [
  "SIGNED ROTATING QR",
  "LIVE HEADCOUNT",
  "OFFLINE SCAN QUEUE",
  "WEEK MENU PLANNER",
  "MEAL PLANS & PAUSES",
  "ABSENCE REQUESTS",
  "COUNTER SALES",
  "CSV IMPORT & REPORTS",
  "ROW-LEVEL SECURITY",
  "TENANT-LOCAL TIME",
] as const;

export interface Feature {
  readonly tag: string;
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
  readonly icon:
    "QrCode" | "ChefHat" | "ClipboardList" | "UtensilsCrossed" | "CalendarOff" | "Receipt";
}

export const FEATURES: readonly Feature[] = [
  {
    tag: "01 / ATTENDANCE",
    title: "Signed QR at the counter",
    body: "Each student carries a QR that rotates every few seconds and is signed by the server, so a screenshot from yesterday gets nobody fed.",
    points: [
      "Distinct outcome per scan — served, already served, no plan",
      "Audited manual entry when a phone dies",
      "Scans queue offline and sync when Wi-Fi returns",
    ],
    icon: "QrCode",
  },
  {
    tag: "02 / KITCHEN",
    title: "A headcount you can cook to",
    body: "Live meal counts per slot update with every scan, and a snapshot before service tells the kitchen how many plates to plan.",
    points: [
      "Realtime count for breakfast, lunch, snacks and dinner",
      "Absences and pauses already subtracted",
      "Daily snapshot for leftover and waste review",
    ],
    icon: "ChefHat",
  },
  {
    tag: "03 / PLANS",
    title: "Meal plans without spreadsheets",
    body: "Monthly or custom plans with the price and meal slots frozen at assignment, so a later price change never rewrites what a student signed up for.",
    points: [
      "Assign, renew, pause and end with a full history",
      "Price and slot snapshots per subscription",
      "Bulk student import from CSV",
    ],
    icon: "ClipboardList",
  },
  {
    tag: "04 / MENU",
    title: "The week's menu, everywhere",
    body: "Plan the week once. Students see today's menu in the app the moment it is published, and special meals go out as announcements.",
    points: [
      "Week planner with CSV import",
      "Today's menu on every student's phone",
      "Special-meal announcements",
    ],
    icon: "UtensilsCrossed",
  },
  {
    tag: "05 / STUDENTS",
    title: "Absences and feedback, handled",
    body: "Students skip a meal or request days away from the app, within the rules your mess sets. Feedback reaches the office instead of the corridor.",
    points: [
      "Skip a meal ahead of the cutoff",
      "Away requests with optional approval",
      "Meal feedback, on when you want it",
    ],
    icon: "CalendarOff",
  },
  {
    tag: "06 / COUNTER",
    title: "Counter sales and reports",
    body: "Guest plates and extras are rung up at the counter as paid or unpaid, and every figure the office needs exports in a click.",
    points: [
      "Paid / unpaid bills at the counter",
      "Attendance and sales exports",
      "Money kept in exact paise, never rounded",
    ],
    icon: "Receipt",
  },
];

export const DAY_STEPS = [
  {
    step: "STEP 01",
    title: "Plan",
    body: "The admin publishes the week's menu and assigns plans. Students see it on their phones.",
  },
  {
    step: "STEP 02",
    title: "Show",
    body: "At meal time a student opens the app. Their QR is live, signed and rotating.",
  },
  {
    step: "STEP 03",
    title: "Scan",
    body: "Counter staff scan it. The verdict — served or why not — is readable from a metre away.",
  },
  {
    step: "STEP 04",
    title: "Cook",
    body: "Every scan moves the live count. Tomorrow's headcount is known before the kitchen starts.",
  },
] as const;

export const SURFACES = [
  {
    name: "Student app",
    platform: "iOS & ANDROID",
    body: "The QR is the hero: legible at arm's length in a queue, plus today's menu, the plan and absences.",
  },
  {
    name: "Counter app",
    platform: "iOS & ANDROID TABLETS",
    body: "Built for a rush: enormous verdicts, a sound per outcome, manual fallback and a live count.",
  },
  {
    name: "Admin console",
    platform: "WEB",
    body: "Dense and complete: students, plans, menus, attendance, headcount, reports and settings.",
  },
] as const;

export interface PricingTier {
  readonly name: string;
  readonly tagline: string;
  readonly features: readonly string[];
  readonly highlight: boolean;
  readonly cta: string;
}

export const PRICING: readonly PricingTier[] = [
  {
    name: "Pilot",
    tagline: "Try MealAdda with one mess and real students.",
    features: [
      "One mess, guided onboarding",
      "Signed QR attendance & manual fallback",
      "Menus, plans and live headcount",
      "Student and counter apps",
    ],
    highlight: false,
    cta: "Start a pilot",
  },
  {
    name: "Mess",
    tagline: "Everything a running hostel mess needs, every day.",
    features: [
      "Everything in Pilot",
      "Absences, pauses and renewals",
      "Counter sales, announcements & feedback",
      "CSV import, exports and reports",
      "Support from the team that builds it",
    ],
    highlight: true,
    cta: "Talk to us",
  },
  {
    name: "Campus",
    tagline: "Several messes or hostels under one operator.",
    features: [
      "Everything in Mess",
      "Multiple messes, isolated data per mess",
      "Platform admin across every mess",
      "Onboarding for each new hostel",
    ],
    highlight: false,
    cta: "Contact sales",
  },
];

export const PRINCIPLES = [
  {
    title: "Fail closed",
    body: "If the server can't verify a QR, the scan is denied and staff use the audited fallback. A bypassable code costs more than a 20-second delay.",
  },
  {
    title: "Money is exact",
    body: "Every amount is whole paise in the database — never a float, never rounded — so a bill always adds up to what was paid.",
  },
  {
    title: "Your hostel's clock",
    body: "Cutoffs, today's menu and the daily headcount follow your mess's own timezone, not a server somewhere else.",
  },
  {
    title: "Your data stays yours",
    body: "Every mess is isolated at the database itself. One hostel can never see another's students.",
  },
] as const;

/** The "About us" story. Edit freely — nothing else depends on the wording. */
export const ABOUT_PARAGRAPHS = [
  "MealAdda started from a simple observation: a hostel mess is a small logistics operation that runs on paper registers, WhatsApp groups and guesswork. Students get turned away over a lost card, kitchens cook for a headcount nobody knows, and the office reconciles it all at the end of the month.",
  "We are building the system we wished those messes had — already running in a live hostel mess, three times a day. We engineer it like payments software, because to a student standing at the counter, it is.",
] as const;
