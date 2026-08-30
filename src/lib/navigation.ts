import type { UserRole } from "@/core/domain/enums";

/**
 * Navigation, defined once per role.
 *
 * Kept as data rather than JSX so the same definition drives the desktop
 * sidebar, the mobile drawer and (later) the student bottom bar. Three
 * hand-maintained copies of a nav is how a link ends up missing on mobile only.
 *
 * `disabled` marks routes whose phase has not shipped yet. Showing them greyed
 * out tells the mess owner what is coming; hiding them entirely makes the
 * product look thinner than it is. Remove the flag as each phase lands.
 */
export interface NavItem {
  readonly label: string;
  readonly href: string;
  /** lucide-react icon name, resolved in the shell. */
  readonly icon: string;
  readonly disabled?: boolean;
  readonly badge?: string;
}

export interface NavSection {
  readonly heading?: string;
  readonly items: readonly NavItem[];
}

function adminNav(features: NavFeatures): readonly NavSection[] {
  const sections = ADMIN_NAV.map((section) => ({ ...section, items: [...section.items] }));

  // Both live under Operations, beside the other day-to-day screens.
  const operations = sections.find((s) => s.heading === "Operations");
  if (operations) {
    if (features.allowAnnouncements) {
      operations.items.push({
        label: "Announcements",
        href: "/admin/announcements",
        icon: "Megaphone",
      });
    }
    if (features.allowFeedback) {
      operations.items.push({
        label: "Feedback",
        href: "/admin/feedback",
        icon: "MessageSquare",
      });
    }
  }

  return sections;
}

const ADMIN_NAV: readonly NavSection[] = [
  {
    items: [{ label: "Dashboard", href: "/admin", icon: "LayoutDashboard" }],
  },
  {
    heading: "Operations",
    items: [
      { label: "Students", href: "/admin/students", icon: "Users" },
      { label: "Plans", href: "/admin/plans", icon: "ClipboardList" },
      { label: "Menu", href: "/admin/menu", icon: "UtensilsCrossed" },
      { label: "Attendance", href: "/admin/attendance", icon: "ScanLine" },
      { label: "Headcount", href: "/admin/headcount", icon: "ChefHat" },
      // Always shown, even when absences are off: this is where the admin sees
      // what students have already asked for, and requests submitted while the
      // feature was on do not disappear when it is turned off.
      { label: "Absences", href: "/admin/absences", icon: "CalendarOff" },
      // Deliberately NOT called "Billing": that entry below is reserved for
      // Phase 2 subscription invoices, and two screens of that name showing
      // unrelated totals is how an owner loses track of what the mess earned.
      { label: "Counter sales", href: "/admin/counter-sales", icon: "Receipt" },
    ],
  },
  {
    heading: "Insight",
    items: [{ label: "Reports", href: "/admin/reports", icon: "FileSpreadsheet" }],
  },
  {
    heading: "Finance",
    items: [
      {
        label: "Billing",
        href: "/admin/billing",
        icon: "Receipt",
        disabled: true,
        badge: "Phase 2",
      },
      {
        label: "Payments",
        href: "/admin/payments",
        icon: "IndianRupee",
        disabled: true,
        badge: "Phase 2",
      },
    ],
  },
  {
    heading: "Configuration",
    items: [{ label: "Settings", href: "/admin/settings", icon: "Settings" }],
  },
];

/**
 * The one section a mess admin never sees.
 *
 * Appended for SUPER_ADMIN rather than folded into ADMIN_NAV, because the two
 * roles differ by exactly this: a mess admin runs one hostel and has no concept
 * of a second one existing.
 */
const PLATFORM_NAV: NavSection = {
  heading: "Platform",
  items: [{ label: "Messes", href: "/admin/messes", icon: "Building2" }],
};

const STAFF_NAV: readonly NavSection[] = [
  {
    items: [
      { label: "Scan", href: "/staff", icon: "ScanLine" },
      { label: "Manual entry", href: "/staff/manual", icon: "Keyboard" },
      { label: "Live count", href: "/staff/counts", icon: "ChefHat" },
      { label: "Counter sales", href: "/staff/sales", icon: "Receipt" },
    ],
  },
];

/**
 * Tenant toggles that change what a role can see.
 *
 * Passed in rather than read here, because this module is a leaf with no data
 * access. Every field is optional and every default is `false` — a caller that
 * forgets to pass settings shows nothing, rather than advertising a feature the
 * mess never turned on.
 */
export interface NavFeatures {
  readonly allowMealSkipping?: boolean;
  readonly allowAwayRequests?: boolean;
  readonly allowAnnouncements?: boolean;
  readonly allowFeedback?: boolean;
}

function studentNav(features: NavFeatures): readonly NavSection[] {
  const items: NavItem[] = [
    { label: "My QR", href: "/student", icon: "QrCode" },
    { label: "Menu", href: "/student/menu", icon: "UtensilsCrossed" },
    { label: "My plan", href: "/student/plan", icon: "ClipboardList" },
  ];

  // Either toggle is enough: a mess may take holiday notice without allowing
  // single-meal skips. The page itself shows only the halves that are on.
  if (features.allowMealSkipping || features.allowAwayRequests) {
    items.push({ label: "Absences", href: "/student/absences", icon: "CalendarOff" });
  }

  // The one place a student writes to this system, and the only student nav
  // item behind a toggle that defaults to off.
  if (features.allowFeedback) {
    items.push({ label: "Feedback", href: "/student/feedback", icon: "MessageSquare" });
  }

  items.push({
    label: "Billing",
    href: "/student/billing",
    icon: "Receipt",
    disabled: true,
    badge: "Phase 2",
  });

  return [{ items }];
}

export function navigationFor(role: UserRole, features: NavFeatures = {}): readonly NavSection[] {
  switch (role) {
    case "STUDENT":
      return studentNav(features);
    case "STAFF":
      return STAFF_NAV;
    case "ADMIN":
      return adminNav(features);
    case "SUPER_ADMIN":
      // Through adminNav, not ADMIN_NAV: the platform operator supports
      // customers, so it must see exactly the screens their admin sees.
      return [...adminNav(features), PLATFORM_NAV];
  }
}

/** Human label for a role, for the user menu. */
export function roleLabel(role: UserRole): string {
  switch (role) {
    case "STUDENT":
      return "Student";
    case "STAFF":
      return "Counter staff";
    case "ADMIN":
      return "Mess admin";
    case "SUPER_ADMIN":
      return "Platform admin";
  }
}
