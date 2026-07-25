import { cn } from "@/lib/utils";

/**
 * Status badge with a fixed colour vocabulary (DESIGN.md §3).
 *
 * The same status always renders the same colour across every screen, and the
 * label is always present — colour is never the only signal. That matters for
 * the ~8% of men with colour vision deficiency, and doubly on the scanner,
 * which is read at speed under bad canteen lighting.
 */

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

const TONE_CLASSES: Record<StatusTone, string> = {
  success:
    "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-400/20",
  warning:
    "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-400/20",
  danger:
    "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-400/20",
  neutral:
    "bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-400/20",
  info: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-400/20",
};

/**
 * Domain status → tone. One map, so a status can never be emerald on one screen
 * and amber on another.
 */
const STATUS_TONES: Record<string, StatusTone> = {
  // Students
  ACTIVE: "success",
  GRACE: "warning",
  BLOCKED: "danger",
  INACTIVE: "neutral",
  // Subscriptions
  PENDING_PAYMENT: "warning",
  EXPIRED: "neutral",
  CANCELLED: "neutral",
  // Invoices (Phase 2)
  PAID: "success",
  PARTIALLY_PAID: "warning",
  OVERDUE: "danger",
  DRAFT: "neutral",
  ISSUED: "info",
  VOID: "neutral",
  // Mess cuts
  APPROVED: "success",
  REJECTED: "danger",
  CREDITED: "info",
  // Attendance method
  QR: "success",
  MANUAL: "warning",
  RFID: "info",
  // Profiles / tenants
  DISABLED: "neutral",
  SUSPENDED: "danger",
};

/** Turns SCREAMING_SNAKE into readable text: PENDING_PAYMENT -> Pending payment. */
export function humanizeStatus(status: string): string {
  const lower = status.toLowerCase().replace(/_/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function StatusBadge({
  status,
  tone,
  className,
}: {
  status: string;
  /** Override the mapped tone. Rarely needed — prefer extending STATUS_TONES. */
  tone?: StatusTone;
  className?: string;
}) {
  const resolved = tone ?? STATUS_TONES[status] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONE_CLASSES[resolved],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          resolved === "success" && "bg-emerald-500",
          resolved === "warning" && "bg-amber-500",
          resolved === "danger" && "bg-red-500",
          resolved === "info" && "bg-sky-500",
          resolved === "neutral" && "bg-slate-400",
        )}
      />
      {humanizeStatus(status)}
    </span>
  );
}
