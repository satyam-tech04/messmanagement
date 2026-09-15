import { Coffee, Moon, Soup, Sunrise } from "lucide-react";
import { cn } from "@/lib/utils";

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
      className={cn("drop-shadow-2xl", className)}
      role="presentation"
    >
      <defs>
        <radialGradient id="thali-face" cx="45%" cy="40%" r="65%">
          <stop offset="0%" stopColor="var(--plate-face)" />
          <stop offset="100%" stopColor="var(--plate-rim)" />
        </radialGradient>
        <radialGradient id="katori" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="var(--plate-face)" />
          <stop offset="100%" stopColor="var(--plate-rim)" />
        </radialGradient>
      </defs>

      {/* Plate */}
      <ellipse cx="200" cy="214" rx="186" ry="186" fill="var(--plate-shadow)" />
      <circle cx="200" cy="200" r="186" fill="var(--plate-rim)" />
      <circle cx="200" cy="200" r="170" fill="url(#thali-face)" />
      <circle
        cx="200"
        cy="200"
        r="170"
        fill="none"
        stroke="var(--plate-rim)"
        strokeWidth="2"
        opacity="0.6"
      />

      {/* Rice mound */}
      <ellipse cx="205" cy="250" rx="78" ry="58" fill="var(--food-cream)" />
      {Array.from({ length: 34 }).map((_, i) => {
        const a = (i * 137.5 * Math.PI) / 180;
        const r = 10 + ((i * 7) % 48);
        return (
          <ellipse
            key={i}
            cx={205 + Math.cos(a) * r * 1.25}
            cy={250 + Math.sin(a) * r * 0.9}
            rx="4"
            ry="1.6"
            transform={`rotate(${(i * 53) % 180} ${205 + Math.cos(a) * r * 1.25} ${250 + Math.sin(a) * r * 0.9})`}
            fill="#e9dcc0"
          />
        );
      })}
      {/* Coriander on the rice */}
      <circle cx="222" cy="236" r="4" fill="var(--food-leaf)" />
      <circle cx="190" cy="258" r="3" fill="var(--food-leaf)" />

      {/* Rotis, overlapping */}
      <circle cx="112" cy="232" r="52" fill="var(--food-roti)" />
      <circle cx="104" cy="222" r="52" fill="#e5b876" />
      {[
        [90, 205],
        [118, 214],
        [96, 240],
        [124, 238],
        [80, 226],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 2 ? 3 : 4.5} fill="#a8733a" opacity="0.55" />
      ))}

      {/* Katori — dal */}
      <circle cx="140" cy="116" r="44" fill="url(#katori)" />
      <circle cx="140" cy="116" r="35" fill="var(--food-turmeric)" />
      <circle cx="130" cy="108" r="4" fill="#fff4cf" opacity="0.8" />
      <circle cx="150" cy="122" r="3" fill="var(--food-chilli)" opacity="0.85" />

      {/* Katori — sabzi */}
      <circle cx="244" cy="96" r="44" fill="url(#katori)" />
      <circle cx="244" cy="96" r="35" fill="#5a9a45" />
      {[
        [232, 86, "#e7d27a"],
        [254, 90, "#f0f0e0"],
        [240, 108, "#e7d27a"],
        [258, 106, "#3f7a33"],
      ].map(([x, y, c], i) => (
        <rect
          key={i}
          x={Number(x) - 5}
          y={Number(y) - 5}
          width="10"
          height="10"
          rx="2"
          fill={String(c)}
        />
      ))}

      {/* Katori — paneer curry */}
      <circle cx="318" cy="170" r="42" fill="url(#katori)" />
      <circle cx="318" cy="170" r="33" fill="var(--food-chilli)" />
      <rect x="304" y="158" width="12" height="12" rx="2" fill="#fff6e6" />
      <rect x="320" y="172" width="12" height="12" rx="2" fill="#fff6e6" />
      <circle cx="312" cy="182" r="3" fill="var(--food-leaf)" />

      {/* Salad */}
      <circle cx="310" cy="268" r="20" fill="#e24b3b" />
      <circle cx="310" cy="268" r="13" fill="#f08070" />
      <circle cx="286" cy="296" r="16" fill="#9fd08a" />
      <circle cx="286" cy="296" r="10" fill="#d6efc9" />
      <circle cx="324" cy="300" r="14" fill="none" stroke="#e6d6f0" strokeWidth="5" />

      {/* Gulab jamun */}
      <circle cx="176" cy="332" r="16" fill="#7a3416" />
      <circle cx="206" cy="336" r="15" fill="#8c3d1a" />
      <circle cx="171" cy="327" r="4" fill="#c9764a" opacity="0.7" />

      {/* Steam from the dal and curry */}
      <g stroke="var(--plate-rim)" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.9">
        <path className="steam" d="M130 64 q-8 -12 0 -24 q8 -12 0 -24" />
        <path
          className="steam"
          style={{ animationDelay: "1.1s" }}
          d="M150 70 q-8 -12 0 -24 q8 -12 0 -24"
        />
        <path
          className="steam"
          style={{ animationDelay: "0.6s" }}
          d="M318 118 q-8 -12 0 -24 q8 -12 0 -24"
        />
      </g>
    </svg>
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
