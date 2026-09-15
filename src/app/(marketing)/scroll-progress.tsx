"use client";

import { useEffect, useRef } from "react";

/**
 * The thin Aurora gradient bar at the very top that tracks reading progress.
 *
 * Writes the width straight to the element on scroll rather than through
 * state, so scrolling a long page does not re-render React sixty times a second.
 */
export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const el = document.documentElement;
      const progress = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
      if (bar.current) bar.current.style.transform = `scaleX(${progress})`;
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <div
      ref={bar}
      aria-hidden="true"
      className="fixed top-0 left-0 z-50 h-0.5 w-full origin-left"
      style={{
        transform: "scaleX(0)",
        background: "linear-gradient(90deg, var(--aurora-1), var(--aurora-2))",
      }}
    />
  );
}
