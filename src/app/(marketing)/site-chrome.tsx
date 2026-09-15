import Link from "next/link";
import { LogIn } from "lucide-react";
import { AuroraMark } from "@/components/aurora-backdrop";
import { ThemeToggle } from "@/components/theme-toggle";
import { APP_NAME } from "@/lib/app-info";
import { LEGAL_PAGES, SITE_TAGLINE } from "@/lib/site";
import { NAV_LINKS } from "./content";

/**
 * The public site's header and footer, shared by the landing page and the legal
 * pages so a reviewer arriving at /privacy from a store listing sees the same
 * product as someone arriving at /.
 *
 * Section links are written as `/#features`: on the landing page that is an
 * in-page jump, and from /terms it goes home and then to the section.
 */
export function SiteHeader() {
  return (
    <header
      className="sticky top-0 z-40 border-b backdrop-blur-xl"
      style={{ background: "var(--glass-header)" }}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label={`${APP_NAME} home`}>
          <AuroraMark />
          <span className="font-heading text-lg font-black tracking-tight">{APP_NAME}</span>
        </Link>

        <nav
          aria-label="Sections"
          className="text-muted-foreground hidden items-center gap-8 text-sm font-medium md:flex"
        >
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={`/${l.href}`}
              className="hover:text-foreground transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link
            href="/login"
            className="bg-foreground text-background focus-visible:ring-ring/50 inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-bold transition-transform hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:outline-none"
          >
            <LogIn className="size-4" aria-hidden="true" />
            Sign in
          </Link>
        </div>
      </div>
      <nav
        aria-label="Sections"
        className="text-muted-foreground flex items-center gap-5 overflow-x-auto border-t px-4 py-2 text-xs font-medium md:hidden"
      >
        {NAV_LINKS.map((l) => (
          <Link
            key={l.href}
            href={`/${l.href}`}
            className="hover:text-foreground whitespace-nowrap"
          >
            {l.label}
          </Link>
        ))}
        <ThemeToggle className="ml-auto shrink-0 sm:hidden" />
      </nav>
    </header>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="text-muted-foreground border-t">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-4 py-10 text-sm sm:px-8">
        <div className="flex items-center gap-2.5">
          <AuroraMark className="h-6" />
          <span className="text-foreground font-heading font-black">{APP_NAME}</span>
          <span className="hidden sm:inline">· {SITE_TAGLINE}</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/#features" className="hover:text-foreground">
            Features
          </Link>
          <Link href="/#pricing" className="hover:text-foreground">
            Pricing
          </Link>
          {LEGAL_PAGES.map((page) => (
            <Link key={page.href} href={page.href} className="hover:text-foreground">
              {page.label}
            </Link>
          ))}
        </nav>
        <p>
          © {year} {APP_NAME}
        </p>
      </div>
    </footer>
  );
}
