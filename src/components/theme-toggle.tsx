"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", hint: "Indigo", Icon: Sun },
  { value: "dark", label: "Dark", hint: "Teal", Icon: Moon },
  { value: "system", label: "Match device", hint: "Auto", Icon: Monitor },
] as const;

const subscribeNever = () => () => {};

/**
 * Three-way theme switch as a segmented radio group.
 *
 * A radio group rather than a cycling button: "what happens if I press this"
 * should never be a guess. Keyboard follows the ARIA radio pattern — one tab
 * stop, arrow keys move and select.
 * Rendered as a neutral placeholder until mounted, because the server cannot
 * know the stored choice and a mismatched `aria-checked` is a hydration error.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  // False on the server and during hydration, true after — without an effect
  // that sets state and re-renders.
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const current = mounted ? (theme ?? "system") : null;
  const activeIndex = Math.max(
    0,
    OPTIONS.findIndex((o) => o.value === current),
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = OPTIONS[(activeIndex + step + OPTIONS.length) % OPTIONS.length]!;
    setTheme(next.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]");
    buttons[(activeIndex + step + OPTIONS.length) % OPTIONS.length]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      onKeyDown={onKeyDown}
      className={cn(
        "aurora-chip inline-flex items-center gap-0.5 rounded-full p-0.5 backdrop-blur",
        className,
      )}
    >
      {OPTIONS.map(({ value, label, hint, Icon }, index) => {
        const checked = current === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === activeIndex ? 0 : -1}
            aria-label={`${label} (${hint})`}
            title={`${label} · ${hint}`}
            onClick={() => setTheme(value)}
            className={cn(
              "flex size-8 items-center justify-center rounded-full transition-colors",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
              checked ? "aurora-fill shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
