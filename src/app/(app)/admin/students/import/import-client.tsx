"use client";

/**
 * Upload → preview → commit.
 *
 * The preview is the point of the whole screen. Nothing is written while it is
 * on show, and the commit button stays disabled until every row is clean —
 * because a file that half-applies and fails on row 147 is a reconciliation job
 * nobody has time for.
 *
 * The commit loop lives here, in the browser, rather than in one long server
 * call: each new student costs an Auth round trip, so a few hundred of them is
 * far past any serverless request limit. Batching also means progress is real
 * rather than a spinner, and a dropped connection loses one batch.
 */
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Download, FileUp, Loader2, Upload, UserPlus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableShell } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { formatPaise, toPaise } from "@/core/money";
import type { ImportRow } from "@/core/policies/student-import.policy";
import { IMPORT_BATCH_SIZE } from "./batch-size";
import { commitImportBatch, previewImport, type ImportPreviewState } from "./actions";

interface Progress {
  readonly done: number;
  readonly total: number;
  readonly created: number;
  readonly updated: number;
  readonly failures: readonly { rollNumber: string; error: string }[];
  readonly finished: boolean;
}

function PreviewButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Checking the file…
        </>
      ) : (
        <>
          <FileUp className="size-4" aria-hidden="true" />
          Check file
        </>
      )}
    </Button>
  );
}

export function ImportClient({ planNames }: { planNames: readonly string[] }) {
  const [state, formAction] = useActionState<ImportPreviewState, FormData>(previewImport, {});
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);

  const rows = state.preview?.rows ?? [];

  async function commit() {
    if (rows.length === 0) return;
    setProgress({
      done: 0,
      total: rows.length,
      created: 0,
      updated: 0,
      failures: [],
      finished: false,
    });

    let created = 0;
    let updated = 0;
    const failures: { rollNumber: string; error: string }[] = [];

    for (let offset = 0; offset < rows.length; offset += IMPORT_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + IMPORT_BATCH_SIZE);
      const data = new FormData();
      data.set("rows", JSON.stringify(batch));
      data.set("offset", String(offset));

      // Awaited in sequence, deliberately. Overlapping batches would race on
      // the same roll numbers and hammer a rate-limited Auth endpoint.
      const result = await commitImportBatch(undefined, data);
      created += result.created;
      updated += result.updated;
      failures.push(...result.failures);

      setProgress({
        done: Math.min(offset + IMPORT_BATCH_SIZE, rows.length),
        total: rows.length,
        created,
        updated,
        failures: [...failures],
        finished: false,
      });
    }

    setProgress({
      done: rows.length,
      total: rows.length,
      created,
      updated,
      failures,
      finished: true,
    });
  }

  // --- Finished ---
  if (progress?.finished) {
    return (
      <div className="space-y-5">
        <Card className="border-emerald-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <Check className="size-5" aria-hidden="true" />
              Import finished
            </CardTitle>
            <CardDescription>
              {progress.created} student{progress.created === 1 ? "" : "s"} created,{" "}
              {progress.updated} updated
              {progress.failures.length > 0 ? `, ${progress.failures.length} failed` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {progress.failures.length > 0 ? (
              <div className="border-destructive/30 bg-destructive/10 rounded-lg border px-3.5 py-3 text-sm">
                <p className="text-destructive mb-2 font-medium">
                  These were not imported. No login exists for them — fix and import them again.
                </p>
                <ul className="space-y-1">
                  {progress.failures.map((f) => (
                    <li key={f.rollNumber}>
                      <span className="font-mono">{f.rollNumber}</span> — {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* New students each got a generated password that is not stored
                readably. The roster export does not contain them, so this says
                plainly what the next step is rather than leaving the admin to
                discover nobody can log in. */}
            {progress.created > 0 ? (
              <p className="text-muted-foreground text-sm">
                Imported students cannot sign in until they have a password. Open each student and
                use <strong>Reset password</strong>, or add them through{" "}
                <Link href="/admin/students/new" className="underline">
                  Add students
                </Link>{" "}
                instead, which shows passwords as it creates them.
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button render={<Link href="/admin/students">See all students</Link>} />
              <Button variant="outline" onClick={() => window.location.reload()}>
                Import another file
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Committing ---
  if (progress) {
    const pct = Math.round((progress.done / progress.total) * 100);
    return (
      <Card>
        <CardHeader>
          <CardTitle>Importing…</CardTitle>
          <CardDescription>
            {progress.done} of {progress.total} rows. Leave this page open — closing it stops the
            import partway.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full transition-all"
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <p className="text-muted-foreground text-sm tabular-nums">
            {progress.created} created · {progress.updated} updated
            {progress.failures.length > 0 ? ` · ${progress.failures.length} failed` : ""}
          </p>
        </CardContent>
      </Card>
    );
  }

  // --- Preview ---
  if (state.preview) {
    const s = state.preview.summary;
    return (
      <div className="space-y-5">
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle>Ready to import</CardTitle>
            <CardDescription>
              Nothing has been written yet. Check these numbers before continuing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-4">
              {[
                ["New students", String(s.create)],
                ["Updated", String(s.update)],
                ["Plans assigned", String(s.subscriptions)],
                ["Total value", formatPaise(toPaise(s.totalPaise))],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border px-3.5 py-3">
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="mt-0.5 text-xl font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void commit()}>
                <Upload className="size-4" aria-hidden="true" />
                Import {rows.length} row{rows.length === 1 ? "" : "s"}
              </Button>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Choose a different file
              </Button>
            </div>
          </CardContent>
        </Card>

        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Row</TableHead>
                <TableHead>Roll number</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row: ImportRow) => (
                <TableRow key={row.rowNumber}>
                  <TableCell className="text-muted-foreground text-xs tabular-nums">
                    {row.rowNumber}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{row.student.rollNumber}</TableCell>
                  <TableCell className="text-sm">
                    {row.student.fullName}
                    {row.warnings.length > 0 ? (
                      <span className="block text-xs text-amber-700 dark:text-amber-400">
                        {row.warnings.join(" ")}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {[row.student.block, row.student.roomNumber].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.subscription ? (
                      <>
                        {row.subscription.planName}
                        <span className="text-muted-foreground block text-xs tabular-nums">
                          {row.subscription.startDate} → {row.subscription.endDate}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {row.subscription ? formatPaise(toPaise(row.subscription.pricePaise)) : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.action === "CREATE" ? "NEW" : "UPDATE"} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      </div>
    );
  }

  // --- Upload ---
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Choose your file</CardTitle>
          <CardDescription>
            A CSV with a header row. Only <code>roll_number</code> and <code>full_name</code> are
            required; every other column is optional and unknown columns are ignored, so you may
            keep your own notes in the sheet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={formAction} className="space-y-4">
            {/* The file is read in the browser and posted as text: a Server
                Action cannot stream a File, and the whole point of the preview
                is that nothing reaches the database until it is confirmed. */}
            <input type="hidden" name="csv" value={csvText} />
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                setCsvText(await file.text());
              }}
              className="file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 block w-full text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:px-3 file:py-2 file:text-sm file:font-medium"
            />
            {fileName ? (
              <p className="text-muted-foreground text-sm">
                Selected <span className="font-medium">{fileName}</span>
              </p>
            ) : null}

            {state.error ? (
              <div
                role="alert"
                className="border-destructive/30 bg-destructive/10 text-destructive space-y-2 rounded-lg border px-3.5 py-3 text-sm dark:text-red-300"
              >
                <p className="flex items-start gap-2 font-medium">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {state.error}
                </p>
                {state.errors && state.errors.length > 0 ? (
                  <ul className="max-h-64 space-y-1 overflow-y-auto pl-6">
                    {state.errors.map((e, i) => (
                      <li key={`${e.rowNumber}-${e.column}-${i}`}>
                        <span className="font-medium tabular-nums">Row {e.rowNumber}</span>
                        {e.column !== "file" ? ` · ${e.column}` : ""} — {e.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <PreviewButton />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Before you start</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <strong>Create your plans first.</strong> The file refers to a plan by name and will
            never create one — a typo would otherwise invent a plan nobody priced.
            {planNames.length > 0 ? (
              <> Plans you can name right now: {planNames.map((n) => `"${n}"`).join(", ")}.</>
            ) : (
              <>
                {" "}
                You have no active plans yet —{" "}
                <Link href="/admin/plans" className="underline">
                  create one
                </Link>{" "}
                before importing subscriptions.
              </>
            )}
          </p>
          <p>
            <strong>Backdate the start dates.</strong> If the mess has been feeding these students
            for weeks, <code>plan_start_date</code> is when they actually began — leaving it as
            today extends every plan by however long you were late.
          </p>
          <p>
            <strong>Re-uploading is safe.</strong> A roll number that already exists is updated, not
            duplicated. An identical subscription is left alone, and a different one is refused
            rather than overwritten.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              render={
                /* A real anchor, not next/link: this is a route handler that
                   returns a file. Client navigation would try to render the
                   CSV as a page instead of downloading it. */
                // eslint-disable-next-line @next/next/no-html-link-for-pages
                <a href="/admin/students/export">
                  <Download className="size-4" aria-hidden="true" />
                  Download current students as CSV
                </a>
              }
            />
            <Button
              variant="ghost"
              size="sm"
              render={
                <Link href="/admin/students/new">
                  <UserPlus className="size-4" aria-hidden="true" />
                  Add a few by hand instead
                </Link>
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
