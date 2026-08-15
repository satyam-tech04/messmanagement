"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Copy, Loader2, Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { createStudent, type CreateStudentState } from "./actions";

export interface PlanOption {
  readonly id: string;
  readonly name: string;
  readonly pricePaise: number;
  readonly mealSlots: readonly string[];
}

/** Money is formatted only at the render boundary (rule 3). */
function formatPaise(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(paise / 100);
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Creating…
        </>
      ) : (
        <>
          <UserPlus className="size-4" aria-hidden="true" />
          Create student
        </>
      )}
    </Button>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-destructive ml-0.5" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="text-muted-foreground ml-1.5 text-xs font-normal">optional</span>
        )}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

/** The one-time credential handover. */
function CredentialsIssued({ created }: { created: NonNullable<CreateStudentState["created"]> }) {
  const [copied, setCopied] = useState(false);

  const text = `Mess OS login\nRoll number: ${created.rollNumber}\nPassword: ${created.temporaryPassword}`;

  return (
    <Card className="border-emerald-500/40">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
            <Check className="size-5" aria-hidden="true" />
          </div>
          <div>
            <CardTitle>{created.fullName} added</CardTitle>
            <CardDescription>Hand these details to the student.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {created.planWarning ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-50 px-3.5 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{created.planWarning}</span>
          </div>
        ) : null}

        <dl className="bg-muted/50 divide-border divide-y rounded-lg border">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-muted-foreground text-sm">Roll number</dt>
            <dd className="font-mono text-sm font-medium">{created.rollNumber}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-muted-foreground text-sm">Temporary password</dt>
            <dd className="text-right">
              <span className="font-mono text-sm font-medium tracking-wide">
                {created.temporaryPassword}
              </span>
              {/* Saying where it came from saves the admin writing down a
                  number the student already carries. */}
              {created.passwordIsPhone ? (
                <span className="text-muted-foreground block text-xs">their mobile number</span>
              ) : null}
            </dd>
          </div>
        </dl>

        {/* Two genuinely different situations, so two different messages.
            Telling an admin to "write this down" when the password is the
            student's own phone number is noise they will learn to ignore. */}
        {created.passwordIsPhone ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-sky-500/30 bg-sky-50 px-3.5 py-3 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Nothing to write down — just tell them to sign in with their{" "}
              <strong>roll number</strong> and their <strong>10-digit mobile number</strong>. They
              will be asked to set their own password straight away.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-50 px-3.5 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              No mobile number was given, so this password was generated and is shown{" "}
              <strong>once</strong>. It cannot be retrieved later — if it is lost, reset it from the
              student&apos;s page. The student must change it when they first sign in.
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? (
              <>
                <Check className="size-4" aria-hidden="true" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-4" aria-hidden="true" />
                Copy details
              </>
            )}
          </Button>
          <Button variant="outline" render={<Link href="/admin/students/new" />}>
            <Plus className="size-4" aria-hidden="true" />
            Add another
          </Button>
          <Button render={<Link href="/admin/students" />}>Done</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function StudentForm({ plans, today }: { plans: readonly PlanOption[]; today: string }) {
  const [state, formAction] = useActionState<CreateStudentState, FormData>(createStudent, {});
  const [planId, setPlanId] = useState("");

  if (state.created) return <CredentialsIssued created={state.created} />;

  const err = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Student details</CardTitle>
          <CardDescription>
            The roll number becomes their login. It cannot be changed later.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field
            id="rollNumber"
            label="Roll number"
            required
            error={err.rollNumber}
            hint="Letters, digits, dot, underscore or hyphen"
          >
            <Input
              id="rollNumber"
              name="rollNumber"
              required
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="CS21B001"
              aria-invalid={Boolean(err.rollNumber) || undefined}
              className="font-mono"
            />
          </Field>

          <Field id="fullName" label="Full name" required error={err.fullName}>
            <Input
              id="fullName"
              name="fullName"
              required
              autoComplete="off"
              placeholder="Aarav Sharma"
              aria-invalid={Boolean(err.fullName) || undefined}
            />
          </Field>

          <Field id="phone" label="Phone" error={err.phone} hint="Used for reminders later">
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              placeholder="+919876543210"
              aria-invalid={Boolean(err.phone) || undefined}
            />
          </Field>

          <Field id="email" label="Email" error={err.email} hint="Contact address, not their login">
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="aarav@example.com"
              aria-invalid={Boolean(err.email) || undefined}
            />
          </Field>

          <Field id="block" label="Block" error={err.block}>
            <Input id="block" name="block" placeholder="A" />
          </Field>

          <Field id="roomNumber" label="Room number" error={err.roomNumber}>
            <Input id="roomNumber" name="roomNumber" placeholder="101" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Meal plan</CardTitle>
          <CardDescription>
            Assign one now, or leave it and add it later. Without an active plan the student cannot
            generate a QR code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input type="hidden" name="planId" value={planId} />
          {plans.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed px-4 py-6">
              <p className="text-muted-foreground text-sm">
                No plans exist yet. You can add the student now and assign a plan afterwards.
              </p>
              <Button variant="outline" size="sm" render={<Link href="/admin/plans" />}>
                Create a plan
              </Button>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Meal plan">
              <button
                type="button"
                role="radio"
                aria-checked={planId === ""}
                onClick={() => setPlanId("")}
                className={cn(
                  "rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                  "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                  planId === "" ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                )}
              >
                <span className="font-medium">No plan for now</span>
                <span className="text-muted-foreground mt-0.5 block text-xs">Assign one later</span>
              </button>

              {plans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={planId === p.id}
                  onClick={() => setPlanId(p.id)}
                  className={cn(
                    "rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                    "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                    planId === p.id ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground mt-0.5 block text-xs">
                    <span className="tabular-nums">{formatPaise(p.pricePaise)}</span> ·{" "}
                    {p.mealSlots.map((s) => s.toLowerCase()).join(", ")}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Only meaningful once a plan is chosen. Shown then, because the
              mess has usually been feeding the student for days before anyone
              enters them — and recording today would push the end date out by
              exactly that many days, which is meals given away. */}
          {planId ? (
            <div className="mt-4 max-w-xs space-y-2">
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
                Backdate this if they have already been eating. The end date is counted from here,
                so leaving it as today would extend their plan.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {state.error ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{state.error}</span>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <SubmitButton />
        <Button variant="ghost" render={<Link href="/admin/students" />}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
