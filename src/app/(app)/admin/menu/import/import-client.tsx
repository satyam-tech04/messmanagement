"use client";

/**
 * Upload a weekly menu, see exactly what it will do, then commit.
 *
 * The preview is the point. An admin importing a month of food is about to
 * overwrite up to 120 rows, and "12 days already published will be replaced" is
 * the sentence that stops a bad afternoon.
 */
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableShell } from "@/components/data-table";
import { commitMenuImport, previewMenuImport, type MenuImportState } from "./actions";

function Submitting({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return pending ? (
    <>
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {busy}
    </>
  ) : (
    <>{idle}</>
  );
}

function Banner({ state }: { state: MenuImportState }) {
  if (state.error) {
    return (
      <div
        role="alert"
        className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm dark:text-red-300"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{state.error}</span>
      </div>
    );
  }
  if (state.success) {
    return (
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      >
        <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{state.success}</span>
      </div>
    );
  }
  return null;
}

export function MenuImportClient({ today, monthEnd }: { today: string; monthEnd: string }) {
  const [state, formAction] = useActionState(previewMenuImport, {} as MenuImportState);
  const [commitState, commitAction] = useActionState(commitMenuImport, {} as MenuImportState);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = state.preview;
  const blocked = (preview?.errors.length ?? 0) > 0;
  const done = Boolean(commitState.success);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload the weekly menu</CardTitle>
          <CardDescription>
            A CSV with the columns <strong>Day, Meal, Menu Items, Price</strong>. Dishes are
            separated by commas. Rows with no day or meal — tea, chapati, the extras — become
            counter-sale items. The price against each day&apos;s meal is ignored.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="csv" value={csv} />

            <div className="space-y-2">
              <Label htmlFor="file">Menu file</Label>
              <input
                ref={fileRef}
                id="file"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setFileName(file.name);
                  setCsv(await file.text());
                }}
              />
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                  <FileUp className="size-4" aria-hidden="true" />
                  Choose file
                </Button>
                <span className="text-muted-foreground truncate text-sm">
                  {fileName ?? "No file chosen"}
                </span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="from">Publish from</Label>
                <Input
                  id="from"
                  name="from"
                  type="date"
                  required
                  defaultValue={today}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="to">Publish until</Label>
                <Input
                  id="to"
                  name="to"
                  type="date"
                  required
                  defaultValue={monthEnd}
                  className="tabular-nums"
                />
                <p className="text-muted-foreground text-xs">
                  The week repeats across every date in this range.
                </p>
              </div>
            </div>

            <Banner state={state} />

            <Button type="submit" disabled={csv.length === 0}>
              <Submitting idle="Check the file" busy="Reading…" />
            </Button>
          </form>
        </CardContent>
      </Card>

      {preview ? (
        <>
          {preview.errors.length > 0 ? (
            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="text-destructive">
                  {preview.errors.length} problem{preview.errors.length === 1 ? "" : "s"} in the
                  file
                </CardTitle>
                <CardDescription>
                  Nothing has been imported. Fix these rows and upload again — the row numbers match
                  your spreadsheet.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TableShell>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Column</TableHead>
                        <TableHead>Problem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.errors.map((e, i) => (
                        <TableRow key={`${e.rowNumber}-${i}`}>
                          <TableCell className="tabular-nums">
                            {e.rowNumber === 0 ? "—" : e.rowNumber}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{e.column}</TableCell>
                          <TableCell>{e.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableShell>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>What this will do</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3.5">
                  <p className="text-muted-foreground text-xs">Meals published</p>
                  <p className="text-2xl font-semibold tabular-nums">{preview.days}</p>
                  <p className="text-muted-foreground text-xs">
                    {preview.from} to {preview.to}
                  </p>
                </div>
                <div
                  className={
                    preview.replacing > 0
                      ? "rounded-lg border border-amber-500/40 bg-amber-50/60 p-3.5 dark:bg-amber-950/20"
                      : "rounded-lg border p-3.5"
                  }
                >
                  <p className="text-muted-foreground text-xs">Already published</p>
                  <p className="text-2xl font-semibold tabular-nums">{preview.replacing}</p>
                  <p className="text-muted-foreground text-xs">
                    {preview.replacing > 0 ? "will be replaced" : "nothing overwritten"}
                  </p>
                </div>
                <div className="rounded-lg border p-3.5">
                  <p className="text-muted-foreground text-xs">Counter items</p>
                  <p className="text-2xl font-semibold tabular-nums">{preview.newItems}</p>
                  <p className="text-muted-foreground text-xs">
                    new{preview.repricedItems > 0 ? `, ${preview.repricedItems} repriced` : ""}
                  </p>
                </div>
              </div>

              {preview.week.length > 0 ? (
                <TableShell>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Day</TableHead>
                        <TableHead>Meal</TableHead>
                        <TableHead>Dishes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.week.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{r.day}</TableCell>
                          <TableCell className="text-muted-foreground">{r.meal}</TableCell>
                          <TableCell>{r.items}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableShell>
              ) : null}

              {preview.counterItems.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Counter items</p>
                  <div className="flex flex-wrap gap-2">
                    {preview.counterItems.map((i) => (
                      <span
                        key={i.name}
                        className="bg-muted/60 rounded-lg border px-3 py-1.5 text-sm"
                      >
                        {i.name} <span className="tabular-nums">{i.price}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <form action={commitAction} className="space-y-3 border-t pt-4">
                <input type="hidden" name="csv" value={preview.csv} />
                <input type="hidden" name="from" value={preview.from} />
                <input type="hidden" name="to" value={preview.to} />
                <Banner state={commitState} />
                {!done ? (
                  <Button type="submit" disabled={blocked}>
                    <Submitting
                      idle={
                        preview.replacing > 0
                          ? `Publish, replacing ${preview.replacing}`
                          : "Publish these menus"
                      }
                      busy="Publishing…"
                    />
                  </Button>
                ) : null}
              </form>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
