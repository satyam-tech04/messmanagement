/**
 * Everything the landing page says, in one file.
 *
 * Written for a mess owner, a warden or a hostel manager — not an engineer.
 * The product's engineering (signed QR codes, per-mess data isolation, exact
 * money) is real and stays true here, but it is said in the words of the
 * dining hall: nobody sneaks a second plate, nobody else sees your students,
 * the bill always adds up.
 *
 * Every claim is something the shipped product does. Pricing names no numbers
 * until they are decided, and the menu dishes and counts on the mock cards are
 * illustrative, labelled as a sample.
 */
export const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#day", label: "A day at the mess" },
  { href: "#pricing", label: "Pricing" },
  { href: "#about", label: "About us" },
] as const;

/** Rolling strip of dishes — the mess, before the software. */
export const DISHES = [
  "Poha & chai",
  "Aloo paratha",
  "Idli sambar",
  "Rajma chawal",
  "Dal tadka",
  "Veg pulao",
  "Chole bhature",
  "Paneer butter masala",
  "Masala dosa",
  "Kheer on Sundays",
] as const;

export interface Audience {
  readonly who: string;
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
  readonly icon: "GraduationCap" | "ChefHat" | "Store";
}

export const AUDIENCES: readonly Audience[] = [
  {
    who: "For students",
    title: "Know what's cooking. Walk in, eat.",
    body: "Today's menu is on their phone. At the counter they show their meal QR and pick up a plate — no register, no token slips, no lost cards.",
    points: [
      "Today's menu, every meal",
      "Meal QR in the MealAdda app",
      "Skip a meal when going home",
    ],
    icon: "GraduationCap",
  },
  {
    who: "For the kitchen & counter",
    title: "Cook for the students who are actually eating.",
    body: "The count updates with every plate served, and skipped meals are already taken off — so the kitchen stops cooking for empty chairs.",
    points: [
      "Live count for each meal",
      "Fast QR scanning in the rush",
      "Manual entry if a phone dies",
    ],
    icon: "ChefHat",
  },
  {
    who: "For the mess owner",
    title: "Plans, menus and students in one place.",
    body: "See who is on which plan, when it runs out, what was served and what sold at the counter — without a single spreadsheet at month end.",
    points: ["Meal plans & renewals", "Weekly menu planner", "Reports you can download"],
    icon: "Store",
  },
];

export interface Feature {
  readonly title: string;
  readonly body: string;
  readonly icon: "QrCode" | "Soup" | "ClipboardList" | "CalendarOff" | "Megaphone" | "Receipt";
}

export const FEATURES: readonly Feature[] = [
  {
    title: "QR meal pass",
    body: "Every student gets a QR that keeps changing, so a screenshot can't be shared for a free meal.",
    icon: "QrCode",
  },
  {
    title: "Weekly menu",
    body: "Plan breakfast to dinner for the week once. Students see each day's menu on their phone.",
    icon: "Soup",
  },
  {
    title: "Meal plans",
    body: "Monthly or custom plans with lunch, dinner or all meals — pause, renew and track who's covered.",
    icon: "ClipboardList",
  },
  {
    title: "Skip a meal, go home",
    body: "Students mark meals or days away in the app, within your rules, and the kitchen count drops.",
    icon: "CalendarOff",
  },
  {
    title: "Announcements & feedback",
    body: "Tell everyone about Sunday's special, and hear what students thought of the food.",
    icon: "Megaphone",
  },
  {
    title: "Counter sales",
    body: "Guests and extra plates billed right at the counter, marked paid or unpaid.",
    icon: "Receipt",
  },
];

export interface DayMoment {
  readonly time: string;
  readonly title: string;
  readonly body: string;
  readonly icon: "Sunrise" | "Soup" | "House" | "Moon";
}

export const DAY: readonly DayMoment[] = [
  {
    time: "7:00 am",
    title: "The menu is already on every phone",
    body: "Poha and chai for breakfast. Students know before they leave the room.",
    icon: "Sunrise",
  },
  {
    time: "1:00 pm",
    title: "The lunch rush moves quickly",
    body: "Show QR, get a plate. The counter sees at once if someone has already eaten.",
    icon: "Soup",
  },
  {
    time: "4:00 pm",
    title: "A student heads home for the weekend",
    body: "They mark the days away in the app. Tonight's dinner count drops by one.",
    icon: "House",
  },
  {
    time: "9:30 pm",
    title: "Dinner's done, tomorrow is planned",
    body: "The day's meals are counted, so the kitchen knows how much to cook tomorrow.",
    icon: "Moon",
  },
];

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
    tagline: "Try MealAdda in one mess with your real students.",
    features: [
      "One mess, set up with you",
      "QR meal pass & counter scanning",
      "Weekly menu and meal plans",
      "Student and counter apps",
    ],
    highlight: false,
    cta: "Start a pilot",
  },
  {
    name: "Mess",
    tagline: "Everything a busy hostel mess needs, every day.",
    features: [
      "Everything in Pilot",
      "Skip meals, days away & renewals",
      "Counter sales, announcements & feedback",
      "Reports and student import",
      "Help from the team that builds it",
    ],
    highlight: true,
    cta: "Talk to us",
  },
  {
    name: "Campus",
    tagline: "Several messes or hostels under one management.",
    features: [
      "Everything in Mess",
      "Many messes, each kept separate",
      "One login to support every mess",
      "Setup for each new hostel",
    ],
    highlight: false,
    cta: "Contact us",
  },
];

/** What we promise a mess, in plain words. Each maps to real product behaviour. */
export const PROMISES = [
  {
    title: "No free second plate",
    body: "A meal QR works once per meal and changes every few seconds, so it can't be passed around.",
    icon: "ShieldCheck",
  },
  {
    title: "Nobody hungry by mistake",
    body: "If the internet drops, the counter keeps a manual entry that's recorded — students still eat.",
    icon: "HeartHandshake",
  },
  {
    title: "Your students stay private",
    body: "Each mess only ever sees its own students. Nobody else on MealAdda can.",
    icon: "Lock",
  },
  {
    title: "Bills that add up",
    body: "Every rupee is stored exactly, to the paisa, so totals always match what was paid.",
    icon: "IndianRupee",
  },
] as const;

/** The "About us" story. Edit freely — nothing else depends on the wording. */
export const ABOUT_PARAGRAPHS = [
  "Anyone who has lived in a hostel knows the mess: the register at the door, the token slips, the WhatsApp group announcing paneer on Sunday, and a kitchen that never quite knows how many will turn up.",
  "MealAdda is built to make that everyday routine calm — for the students queueing three times a day, the cooks planning the pots, and the owner closing the month. It's already running in a live hostel mess.",
] as const;
