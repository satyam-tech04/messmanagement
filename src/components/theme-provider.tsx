"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Light (Indigo) and dark (Teal), following the device until told otherwise.
 *
 * `attribute="class"` because globals.css keys the dark palette off `.dark`,
 * which is also what the `dark:` variant reads. Transitions are disabled during
 * the switch so a table of 300 rows does not animate every border at once.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="mealadda-theme"
    >
      {children}
    </NextThemesProvider>
  );
}
