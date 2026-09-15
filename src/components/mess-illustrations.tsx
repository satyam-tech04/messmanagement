import { Coffee, Moon, Soup, Sunrise } from "lucide-react";
import { cn } from "@/lib/utils";
import { THALI_SVG_BODY } from "@/components/thali-svg";

/**
 * Food artwork for MealAdda's public and sign-in surfaces.
 *
 * Aurora Depth supplies the atmosphere; these supply the subject — a hostel
 * mess is plates, katoris and four meal times, and the page should look like
 * one before a word is read. Decorative (hidden from assistive tech), drawn in
 * SVG so they stay crisp and theme-aware: the steel plate follows the theme,
 * the food keeps its own colours in both.
 */

/** A steel thali seen from above: rice, roti, dal, sabzi, curry, salad and a sweet. */
export function ThaliIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 400"
      aria-hidden="true"
      role="presentation"
      className={cn("drop-shadow-2xl", className)}
      // Static artwork from a trusted module constant — no user input reaches it.
      dangerouslySetInnerHTML={{ __html: THALI_SVG_BODY }}
    />
  );
}

export const MEAL_TIMES = [
  { meal: "Breakfast", time: "7:30 – 9:30", Icon: Sunrise, tint: "var(--food-turmeric)" },
  { meal: "Lunch", time: "12:30 – 2:30", Icon: Soup, tint: "var(--food-chilli)" },
  { meal: "Snacks & chai", time: "5:00 – 6:00", Icon: Coffee, tint: "var(--food-roti)" },
  { meal: "Dinner", time: "8:00 – 10:00", Icon: Moon, tint: "var(--aurora-2)" },
] as const;

/** A single rounded meal-time chip with a food-tinted icon. */
export function MealChip({
  meal,
  time,
  Icon,
  tint,
  className,
}: (typeof MEAL_TIMES)[number] & { className?: string }) {
  return (
    <div
      className={cn(
        "bg-card/80 flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-sm backdrop-blur-md",
        className,
      )}
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: `color-mix(in oklab, ${tint} 18%, transparent)`, color: tint }}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="leading-tight">
        <p className="font-heading text-sm font-extrabold">{meal}</p>
        <p className="text-muted-foreground text-xs">{time}</p>
      </div>
    </div>
  );
}

/** The student app, drawn: today's menu above the meal QR. */
export function PhoneMock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "bg-foreground/90 relative w-[260px] rounded-[2.4rem] p-2.5 shadow-2xl",
        className,
      )}
    >
      <div className="bg-background relative overflow-hidden rounded-[1.9rem]">
        <div className="bg-foreground/90 absolute top-2 left-1/2 h-5 w-20 -translate-x-1/2 rounded-full" />
        <div className="space-y-3 px-4 pt-10 pb-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-muted-foreground text-[10px]">Good afternoon</p>
              <p className="font-heading text-sm font-extrabold">Hi, Asha 👋</p>
            </div>
            <span className="bg-leaf/15 text-leaf rounded-full px-2 py-0.5 text-[10px] font-bold">
              Plan active
            </span>
          </div>

          <div className="bg-card rounded-2xl border p-3">
            <p className="text-muted-foreground text-[10px] font-semibold">TODAY&apos;S LUNCH</p>
            <ul className="mt-1.5 space-y-1 text-[11px]">
              <li>🍛 Rajma chawal</li>
              <li>🥔 Jeera aloo · 🫓 Roti</li>
              <li>🥗 Salad · 🍮 Gulab jamun</li>
            </ul>
          </div>

          <div className="bg-card flex flex-col items-center gap-2 rounded-2xl border p-3">
            <QrGlyph className="size-24" />
            <p className="text-[10px] font-semibold">Show this at the counter</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A decorative QR-like square. Not a real code — nothing here should scan. */
function QrGlyph({ className }: { className?: string }) {
  const cells = ["1110111", "1010101", "1110111", "0001000", "1101011", "0110110", "1011101"];
  return (
    <svg viewBox="0 0 7 7" className={className} shapeRendering="crispEdges">
      <rect width="7" height="7" fill="#fff" />
      {cells.flatMap((row, y) =>
        row
          .split("")
          .map((c, x) =>
            c === "1" ? (
              <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#141728" />
            ) : null,
          ),
      )}
    </svg>
  );
}
