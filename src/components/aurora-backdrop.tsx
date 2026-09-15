import { cn } from "@/lib/utils";

/**
 * The Aurora Depth ambient layer: three drifting colour orbs over a faded grid.
 *
 * Purely decorative, so it is hidden from assistive tech and never takes
 * pointer events. `intensity="subtle"` is for the signed-in app, where it sits
 * behind data tables and must never compete with a roll number for contrast;
 * `"full"` is for the landing page, sign-in and the operator's persona screen.
 *
 * Motion stops under `prefers-reduced-motion` (globals.css).
 */
export function AuroraBackdrop({
  intensity = "full",
  fixed = true,
  className,
}: {
  intensity?: "full" | "subtle";
  /** Fixed to the viewport (default) or absolutely positioned in a relative parent. */
  fixed?: boolean;
  className?: string;
}) {
  const subtle = intensity === "subtle";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none inset-0 z-0 overflow-hidden",
        fixed ? "fixed" : "absolute",
        subtle && "opacity-60",
        className,
      )}
    >
      <div
        className="aurora-orb"
        style={{
          top: "-18vh",
          left: "-8vw",
          width: "60vw",
          height: "60vw",
          background: "radial-gradient(circle, var(--orb-1), transparent 62%)",
          animationDuration: "17s",
        }}
      />
      <div
        className="aurora-orb"
        style={{
          top: "22vh",
          right: "-14vw",
          width: "52vw",
          height: "52vw",
          background: "radial-gradient(circle, var(--orb-2), transparent 62%)",
          animationDuration: "21s",
          animationDirection: "reverse",
        }}
      />
      {subtle ? null : (
        <div
          className="aurora-orb"
          style={{
            bottom: "-24vh",
            left: "28vw",
            width: "46vw",
            height: "46vw",
            background: "radial-gradient(circle, var(--orb-3), transparent 64%)",
            animationDuration: "25s",
          }}
        />
      )}
      <div className="aurora-grid" />
    </div>
  );
}

/** The brand tile: the gradient square that stands beside the wordmark. */
export function AuroraMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "aurora-fill relative inline-flex size-8 shrink-0 items-center justify-center rounded-[9px]",
        className,
      )}
    >
      {/* A plate seen from above with a scan line across it: a meal, verified. */}
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="8" strokeWidth="2" />
        <circle cx="12" cy="12" r="4" strokeWidth="1.6" opacity="0.7" />
        <path d="M3 12h18" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** Small section label with an optional live dot — sentence case, warm, not a terminal readout. */
export function AuroraEyebrow({
  children,
  pulse = false,
  className,
}: {
  children: React.ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-aurora-1 bg-aurora-1/10 inline-flex w-fit items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-bold",
        className,
      )}
    >
      {pulse ? (
        <span className="bg-aurora-1 aurora-pulse size-1.5 rounded-full" aria-hidden="true" />
      ) : null}
      {children}
    </span>
  );
}
