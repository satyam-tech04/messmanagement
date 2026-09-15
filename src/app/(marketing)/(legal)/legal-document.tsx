import type { ReactNode } from "react";
import { AuroraEyebrow } from "@/components/aurora-backdrop";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface LegalSection {
  /** Anchor id — store listings deep-link to these (`/privacy#children`), so never rename one. */
  readonly id: string;
  readonly title: string;
  readonly body: ReactNode;
}

/**
 * Reading styles for legal copy. The sections are authored as plain JSX
 * (`<p>`, `<ul>`, `<strong>`, `<a>`), so the typography is applied here once
 * rather than repeated on every element of three long documents.
 */
const PROSE = cn(
  "text-muted-foreground space-y-4 text-[15px] leading-relaxed",
  "[&_strong]:text-foreground [&_strong]:font-semibold",
  "[&_a]:text-aurora-1 [&_a]:font-semibold [&_a]:underline-offset-4 [&_a:hover]:underline",
  "[&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5",
  "[&_li]:marker:text-aurora-1 [&_h3]:text-foreground [&_h3]:pt-2 [&_h3]:font-bold",
);

/**
 * A long legal or help document: title block, a sticky table of contents built
 * from the same `sections` array as the body (so the two cannot drift), an
 * optional "In short" summary, then the sections.
 */
export function LegalDocument({
  eyebrow,
  title,
  lead,
  effective,
  summary,
  sections,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lead: string;
  /** Shown as "Effective …". Omit on pages that are guidance rather than terms. */
  effective?: string;
  summary?: readonly string[];
  sections: readonly LegalSection[];
  /** Rendered after the sections, e.g. a call to action. */
  children?: ReactNode;
}) {
  return (
    <main id="main" className="mx-auto max-w-7xl px-4 pt-14 pb-24 sm:px-8 sm:pt-20">
      <header className="flex max-w-3xl flex-col gap-4">
        <AuroraEyebrow>{eyebrow}</AuroraEyebrow>
        <h1 className="text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.04] font-black tracking-[-0.035em]">
          {title}
        </h1>
        <p className="text-muted-foreground max-w-[60ch] text-lg leading-relaxed">{lead}</p>
        {effective ? (
          <p className="text-muted-foreground text-sm">
            Effective <time className="text-foreground font-semibold">{effective}</time>
          </p>
        ) : null}
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
        <nav aria-labelledby="toc-title" className="lg:sticky lg:top-24 lg:self-start">
          <p
            id="toc-title"
            className="text-muted-foreground mb-3 text-xs font-bold tracking-wider uppercase"
          >
            On this page
          </p>
          <ol className="border-border flex flex-col border-l text-sm">
            {sections.map((section, i) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="text-muted-foreground hover:text-foreground hover:border-aurora-1 focus-visible:text-foreground -ml-px flex gap-2 border-l border-transparent py-1.5 pl-4 transition-colors"
                >
                  <span className="tabular-nums">{i + 1}.</span>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="bg-card/80 max-w-3xl min-w-0 rounded-3xl border p-5 backdrop-blur sm:p-10">
          {summary ? (
            <aside
              aria-labelledby="summary-title"
              className="border-aurora-1/25 bg-aurora-1/[0.07] mb-10 rounded-2xl border p-4 sm:p-6"
            >
              <h2 id="summary-title" className="font-heading mb-3 text-base font-extrabold">
                In short
              </h2>
              <ul className={cn(PROSE, "list-disc space-y-2 pl-5")}>
                {summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </aside>
          ) : null}

          <div className="flex flex-col gap-10">
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
                className="scroll-mt-28"
              >
                <h2
                  id={`${section.id}-title`}
                  className="font-heading mb-4 text-xl font-extrabold tracking-tight sm:text-2xl"
                >
                  {section.title}
                </h2>
                <div className={PROSE}>{section.body}</div>
              </section>
            ))}
          </div>

          {children}
        </div>
      </div>
    </main>
  );
}

/** A small reference table inside a legal section (what is collected, who processes it). */
export function LegalTable({
  columns,
  rows,
}: {
  columns: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            {columns.map((c) => (
              <TableHead
                key={c}
                scope="col"
                className="text-foreground font-bold whitespace-nowrap"
              >
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, r) => (
            <TableRow key={r}>
              {row.map((cell, c) => (
                <TableCell
                  key={c}
                  className={cn(
                    "text-muted-foreground align-top whitespace-normal",
                    c === 0 && "text-foreground font-semibold",
                  )}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
