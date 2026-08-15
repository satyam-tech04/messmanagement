"use client";

/**
 * The form a student uses to mark themselves out.
 *
 * Two shapes behind one submit, chosen by a tab, because they are genuinely
 * different decisions: a skip is "not tomorrow's lunch", an away is "I am gone
 * for a fortnight". Merging them into one date-range-plus-checkboxes form makes
 * both harder to fill in correctly.
 *
 * Everything the server will refuse is stated up front — the earliest date the
 * notice period allows is the input's `min`, and the remaining allowance is on
 * screen — so the common refusals never happen.
 */
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CalendarOff, Check, Loader2, Plane } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requestAbsence, type AbsenceActionState } from "./actions";

export interface AbsenceFormProps {
  readonly allowMealSkipping: boolean;
  readonly allowPartialDaySkip: boolean;
  readonly allowAwayRequests: boolean;
  readonly awayRequiresApproval: boolean;
  readonly cutMaxDaysPerMonth: number;
  readonly daysUsedThisMonth: number;
  readonly awayMaxDays: number;
  /** Meals this student's own plan covers — never the mess's full list. */
  readonly plannedSlots: readonly string[];
  /** Earliest date the notice period allows, `YYYY-MM-DD`. */
  readonly earliestSkipDate: string;
  readonly earliestAwayDate: string;
  /** Last day the student's plan covers. Nothing beyond it can be cut. */
  readonly planEndDate: string;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Sending…
        </>
      ) : (
        label
      )}
    </Button>
  );
}

function Feedback({ state }: { state: AbsenceActionState }) {
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

function SkipForm(props: AbsenceFormProps) {
  const [state, formAction] = useActionState<AbsenceActionState, FormData>(requestAbsence, {});
  const [selected, setSelected] = useState<readonly string[]>(props.plannedSlots);

  const remaining = Math.max(0, props.cutMaxDaysPerMonth - props.daysUsedThisMonth);
  const exhausted = remaining === 0;

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="kind" value="SKIP" />

      <div className="bg-muted/50 flex items-baseline justify-between rounded-lg px-3.5 py-3 text-sm">
        <span className="text-muted-foreground">Left this month</span>
        <span className="font-semibold tabular-nums">
          {remaining} of {props.cutMaxDaysPerMonth} days
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="skip-from">First day</Label>
          <Input
            id="skip-from"
            name="dateFrom"
            type="date"
            required
            // The notice period as a boundary rather than an error message.
            min={props.earliestSkipDate}
            max={props.planEndDate}
            defaultValue={props.earliestSkipDate}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="skip-to">Last day</Label>
          <Input
            id="skip-to"
            name="dateTo"
            type="date"
            min={props.earliestSkipDate}
            max={props.planEndDate}
            defaultValue={props.earliestSkipDate}
            className="tabular-nums"
          />
          <p className="text-muted-foreground text-xs">
            Same as the first day for a single day. The allowance resets on the 1st, so a skip
            cannot run into next month.
          </p>
        </div>
      </div>

      <fieldset className="space-y-2.5">
        <legend className="text-sm font-medium">Which meals</legend>
        {props.allowPartialDaySkip ? null : (
          <p className="text-muted-foreground text-xs">
            This mess takes whole days off only, so every meal on your plan is included.
          </p>
        )}
        <div className="flex flex-wrap gap-4">
          {props.plannedSlots.map((slot) => (
            <label key={slot} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                name={`slot_${slot}`}
                checked={selected.includes(slot)}
                // With whole-day-only the boxes are shown but fixed on: the
                // student can see what they are giving up rather than having it
                // happen invisibly.
                disabled={!props.allowPartialDaySkip}
                onCheckedChange={(v) =>
                  setSelected((prev) =>
                    v === true ? [...prev, slot] : prev.filter((s) => s !== slot),
                  )
                }
              />
              <span className="capitalize">{slot.toLowerCase()}</span>
            </label>
          ))}
        </div>
        {/* A disabled checkbox submits nothing, so the value has to be carried
            separately or a whole-day skip would arrive with no meals at all. */}
        {props.allowPartialDaySkip
          ? null
          : props.plannedSlots.map((slot) => (
              <input key={slot} type="hidden" name={`slot_${slot}`} value="on" />
            ))}
      </fieldset>

      <Feedback state={state} />

      {exhausted ? (
        <p className="text-muted-foreground text-sm">
          You have used all {props.cutMaxDaysPerMonth} days this month. The allowance resets on the
          1st.
        </p>
      ) : (
        <SubmitButton label="Skip these meals" />
      )}
    </form>
  );
}

function AwayForm(props: AbsenceFormProps) {
  const [state, formAction] = useActionState<AbsenceActionState, FormData>(requestAbsence, {});

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="kind" value="AWAY" />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="away-from">Leaving on</Label>
          <Input
            id="away-from"
            name="dateFrom"
            type="date"
            required
            min={props.earliestAwayDate}
            max={props.planEndDate}
            defaultValue={props.earliestAwayDate}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="away-to">Back on</Label>
          <Input
            id="away-to"
            name="dateTo"
            type="date"
            required
            min={props.earliestAwayDate}
            max={props.planEndDate}
            defaultValue={props.earliestAwayDate}
            className="tabular-nums"
          />
          <p className="text-muted-foreground text-xs">
            Up to {props.awayMaxDays} days at a time. This is the last day you will be away — you
            are expected at breakfast the morning after.
          </p>
        </div>
      </div>

      <p className="text-muted-foreground text-sm">
        Every meal on your plan is covered for the whole period, and time away does not count
        against your monthly skip allowance.
        {props.awayRequiresApproval
          ? " The mess office reviews these, so it will show as pending until they decide."
          : null}
      </p>

      <Feedback state={state} />
      <SubmitButton label={props.awayRequiresApproval ? "Send request" : "Mark me away"} />
    </form>
  );
}

export function AbsenceForm(props: AbsenceFormProps) {
  // Which half opens first: whichever the mess actually offers. Landing on a
  // tab that is turned off would look broken.
  const [tab, setTab] = useState<"SKIP" | "AWAY">(props.allowMealSkipping ? "SKIP" : "AWAY");

  const bothAvailable = props.allowMealSkipping && props.allowAwayRequests;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tab === "SKIP" ? "Skip a meal" : "Going away"}</CardTitle>
        <CardDescription>
          {tab === "SKIP"
            ? "Tell the kitchen in advance and they will not cook for you. Once a meal is being cooked it is too late to save anything, which is why notice is required."
            : "A longer planned absence — going home, a trip. The kitchen gets warning of the drop in numbers."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {bothAvailable ? (
          <div
            role="tablist"
            aria-label="Kind of absence"
            className="bg-muted inline-flex rounded-lg p-1"
          >
            {(
              [
                ["SKIP", "Skip a meal", CalendarOff],
                ["AWAY", "Going away", Plane],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {/* Keyed so switching tabs resets the other form's state rather than
            carrying a success message across to a different action. */}
        {tab === "SKIP" ? <SkipForm key="skip" {...props} /> : <AwayForm key="away" {...props} />}
      </CardContent>
    </Card>
  );
}
