"use client";

/**
 * Adding several students in one go.
 *
 * A grid rather than a stack of cards, because the job is transcription from a
 * list — the admin is reading down a register, not filling in a profile. Tab
 * moves across a row and down to the next, which is the only interaction that
 * matters here.
 *
 * Everything is validated before a single account exists (see
 * student-batch.policy.ts), so the failure this form is designed around is not
 * a bad row — it is a bad row discovered *after* fifteen logins were created.
 */
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Copy, Loader2, Plus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MAX_BATCH_SIZE } from "@/core/policies/student-batch.policy";
import { createStudentsBulk, type BulkCreateState } from "./actions";
import { cn } from "@/lib/utils";

export interface BulkPlanOption {
  readonly id: string;
  readonly name: string;
  readonly priceLabel: string;
}

const STARTING_ROWS = 5;

interface FieldSpec {
  readonly key: "rollNumber" | "fullName" | "phone" | "block" | "roomNumber";
  readonly label: string;
  readonly width: string;
  readonly placeholder: string;
  /** Roll numbers are compared by eye and read aloud, so digits must align. */
  readonly mono?: boolean;
}

const FIELDS: readonly FieldSpec[] = [
  { key: "rollNumber", label: "Roll number", width: "w-40", placeholder: "CS22B101", mono: true },
  { key: "fullName", label: "Full name", width: "w-56", placeholder: "Priya Menon" },
  { key: "phone", label: "Phone", width: "w-36", placeholder: "9876543210" },
  { key: "block", label: "Block", width: "w-20", placeholder: "A" },
  { key: "roomNumber", label: "Room", width: "w-24", placeholder: "104" },
];

function SubmitButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Creating {count} {count === 1 ? "student" : "students"}…
        </>
      ) : (
        <>
          <UserPlus className="size-4" aria-hidden="true" />
          Add {count} {count === 1 ? "student" : "students"}
        </>
      )}
    </Button>
  );
}

/**
 * The passwords, once.
 *
 * Nothing stores these in readable form, so this panel is the only chance to
 * take them down — which is exactly why it does not disappear on its own and
 * offers a copy of the whole table rather than making the admin transcribe it.
 */
function CredentialsPanel({ rows }: { rows: NonNullable<BulkCreateState["created"]> }) {
  const [copied, setCopied] = useState(false);

  const asText = rows
    .map((r) => `${r.rollNumber}\t${r.fullName}\t${r.temporaryPassword}`)
    .join("\n");

  return (
    <Card className="border-emerald-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <Check className="size-5" aria-hidden="true" />
          {rows.length} {rows.length === 1 ? "student" : "students"} added
        </CardTitle>
        <CardDescription>
          These passwords are shown <strong>once</strong> and are not stored anywhere you can read
          them back. Copy them now — after this you can only reset a password, not recover it. Each
          student must change theirs at first sign-in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Roll number</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Temporary password</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((r) => (
                <tr key={r.rollNumber}>
                  <td className="px-3 py-2 font-mono">{r.rollNumber}</td>
                  <td className="px-3 py-2">
                    {r.fullName}
                    {r.planWarning ? (
                      <span className="block text-xs text-amber-700 dark:text-amber-400">
                        {r.planWarning}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono font-semibold select-all">
                    {r.temporaryPassword}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(asText).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy all"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Add more students
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function BulkStudentForm({
  plans,
  today,
}: {
  plans: readonly BulkPlanOption[];
  today: string;
}) {
  const [state, formAction] = useActionState<BulkCreateState, FormData>(createStudentsBulk, {});
  const [rowCount, setRowCount] = useState(STARTING_ROWS);
  const [planId, setPlanId] = useState("");

  const errorFor = (index: number) => state.rowErrors?.find((e) => e.index === index);

  if (state.created && state.created.length > 0) {
    return (
      <div className="space-y-5">
        <CredentialsPanel rows={state.created} />
        {state.failed && state.failed.length > 0 ? (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-destructive text-base">
                {state.failed.length} could not be created
              </CardTitle>
              <CardDescription>
                These were left out entirely — no login exists for them. Add them again.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {state.failed.map((f) => (
                  <li key={f.rollNumber}>
                    <span className="font-mono font-medium">{f.rollNumber}</span> — {f.error}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Add several students</CardTitle>
          <CardDescription>
            Type or paste one student per row. Only the roll number and name are required — leave
            rows you do not need empty. Nothing is saved until every row is valid, so a mistake on
            row 8 cannot leave rows 1–7 half-created.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {plans.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="planId">Meal plan for everyone in this batch</Label>
              <select
                id="planId"
                name="planId"
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 w-full max-w-md rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                <option value="">No plan — assign later</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.priceLabel}
                  </option>
                ))}
              </select>
              {/* One plan for the batch, not one per row: a form wide enough for
                  a per-row plan is unusable, and an intake typed in together is
                  normally joining the same plan on the same day. The exception
                  is handled on the student's own page. */}
              <p className="text-muted-foreground text-xs">
                Applies to every student below. To give someone a different plan, add them without
                one and assign it from their page.
              </p>

              {/* One date for the batch, matching the one plan. An intake typed
                  in together normally started eating on the same day — and that
                  day is usually before today, because the mess was serving them
                  long before anyone got round to entering them. */}
              {planId ? (
                <div className="max-w-xs space-y-2 pt-2">
                  <Label htmlFor="planStartDate">Plan started on</Label>
                  <Input
                    id="planStartDate"
                    name="planStartDate"
                    type="date"
                    defaultValue={today}
                    max={today}
                    className="tabular-nums"
                  />
                  <p className="text-muted-foreground text-xs">
                    Backdate this if they have already been eating. End dates are counted from here,
                    so leaving it as today would extend everyone&apos;s plan.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="text-muted-foreground w-8 pb-2 text-left text-xs font-medium">
                    #
                  </th>
                  {FIELDS.map((f) => (
                    <th
                      key={f.key}
                      className="text-muted-foreground px-1 pb-2 text-left text-xs font-medium"
                    >
                      {f.label}
                      {f.key === "rollNumber" || f.key === "fullName" ? (
                        <span className="text-destructive"> *</span>
                      ) : null}
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rowCount }, (_, i) => {
                  const rowError = errorFor(i);
                  return (
                    <tr key={i} className="align-top">
                      <td className="text-muted-foreground py-1 pr-2 text-xs tabular-nums">
                        {i + 1}
                      </td>
                      {FIELDS.map((f) => (
                        <td key={f.key} className={cn("px-1 py-1", f.width)}>
                          <Input
                            name={`row-${i}-${f.key}`}
                            placeholder={f.placeholder}
                            aria-label={`${f.label}, row ${i + 1}`}
                            aria-invalid={rowError?.field === f.key}
                            className={cn(
                              "h-9",
                              f.mono && "font-mono",
                              rowError?.field === f.key && "border-destructive",
                            )}
                          />
                        </td>
                      ))}
                      <td className="py-1">
                        {rowCount > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove row ${i + 1}`}
                            onClick={() => setRowCount((n) => Math.max(1, n - 1))}
                            className="text-muted-foreground h-9 px-2"
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Errors listed under the grid as well as marked on the cell: with
              ten rows on screen a red border alone does not say what is wrong. */}
          {state.rowErrors && state.rowErrors.length > 0 ? (
            <ul className="border-destructive/30 bg-destructive/10 text-destructive space-y-1 rounded-lg border px-3.5 py-3 text-sm dark:text-red-300">
              {state.rowErrors.map((e) => (
                <li key={`${e.index}-${e.field}`}>
                  {e.field === "form" ? e.message : `Row ${e.index + 1}: ${e.message}`}
                </li>
              ))}
            </ul>
          ) : state.error ? (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm dark:text-red-300"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{state.error}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rowCount >= MAX_BATCH_SIZE}
              onClick={() => setRowCount((n) => Math.min(MAX_BATCH_SIZE, n + 5))}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add 5 more rows
            </Button>
            <span className="text-muted-foreground text-xs">
              {rowCount} of {MAX_BATCH_SIZE} rows. For a whole hostel, use the CSV import instead.
            </span>
          </div>
        </CardContent>
      </Card>

      <SubmitButton count={rowCount} />
    </form>
  );
}
