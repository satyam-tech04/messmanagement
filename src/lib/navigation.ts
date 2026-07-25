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
    ],
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

const STAFF_NAV: readonly NavSection[] = [
  {
    items: [
      { label: "Scan", href: "/staff", icon: "ScanLine" },
      { label: "Manual entry", href: "/staff/manual", icon: "Keyboard" },
      { label: "Live count", href: "/staff/counts", icon: "ChefHat" },
    ],
  },
];

const STUDENT_NAV: readonly NavSection[] = [
  {
    items: [
      { label: "My QR", href: "/student", icon: "QrCode" },
      { label: "Menu", href: "/student/menu", icon: "UtensilsCrossed" },
      { label: "My plan", href: "/student/plan", icon: "ClipboardList" },
      {
        label: "Billing",
        href: "/student/billing",
        icon: "Receipt",
        disabled: true,
        badge: "Phase 2",
      },
    ],
  },
];

export function navigationFor(role: UserRole): readonly NavSection[] {
  switch (role) {
    case "STUDENT":
      return STUDENT_NAV;
    case "STAFF":
      return STAFF_NAV;
    case "ADMIN":
    case "SUPER_ADMIN":
      return ADMIN_NAV;
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
