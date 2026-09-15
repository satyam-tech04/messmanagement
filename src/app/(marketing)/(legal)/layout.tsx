import type { ReactNode } from "react";
import { AuroraBackdrop } from "@/components/aurora-backdrop";
import { SiteFooter, SiteHeader } from "../site-chrome";

/**
 * Privacy, terms, account deletion and support.
 *
 * Public on purpose — see `LEGAL_PAGES` in lib/site. The backdrop is `subtle`:
 * these are long reading surfaces, and DESIGN.md §0 keeps Aurora quiet wherever
 * it would compete with text.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-svh overflow-x-clip">
      <AuroraBackdrop intensity="subtle" />
      <div className="relative z-10 flex min-h-svh flex-col">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </div>
    </div>
  );
}
