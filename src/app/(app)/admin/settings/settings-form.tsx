"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateSettings, type SettingsActionState } from "./actions";

export interface SlotSetting {
  readonly slot: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
}

export interface AbsenceSetting {
  readonly allowMealSkipping: boolean;
  readonly allowPartialDaySkip: boolean;
  readonly allowAwayRequests: boolean;
  readonly awayRequiresApproval: boolean;
  readonly cutAdvanceHours: number;
  readonly cutMaxDaysPerMonth: number;
  readonly awayAdvanceHours: number;
  readonly awayMaxDays: number;
}

/**
 * A labelled switch that submits as a checkbox.
 *
 * Controlled, because the fields it governs fade with it — but the fields stay
 * *enabled* either way. A disabled input submits nothing, which would arrive as
 * NaN and be rejected as a bad number the admin never touched.
 */
function Toggle({
  name,
  label,
  hint,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <Checkbox
        id={name}
        name={name}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        <span className="text-muted-foreground block text-xs">{hint}</span>
      </span>
    </label>
  );
}

function NumberField({
  name,
  label,
  hint,
  defaultValue,
  min,
  max,
  dimmed,
}: {
  name: string;
  label: string;
  hint: string;
  defaultValue: number;
  min: number;
  max: number;
  dimmed: boolean;
}) {
  return (
    <div className={`space-y-2 transition-opacity ${dimmed ? "opacity-50" : ""}`}>
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type="number"
        min={min}
        max={max}
        step={1}
        defaultValue={defaultValue}
        className="tabular-nums"
      />
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

function AbsenceCard({ absence }: { absence: AbsenceSetting }) {
  const [skipping, setSkipping] = useState(absence.allowMealSkipping);
  const [partial, setPartial] = useState(absence.allowPartialDaySkip);
  const [away, setAway] = useState(absence.allowAwayRequests);
  const [approval, setApproval] = useState(absence.awayRequiresApproval);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Skipping meals</CardTitle>
          <CardDescription>
            Students see no way to skip anything until this is on. Notice is measured to the moment
            the meal opens — a cut arriving after the kitchen has shopped and cooked saves nothing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Toggle
            name="allowMealSkipping"
            label="Let students skip meals"
            hint="They mark themselves out in advance and the plate comes off the headcount."
            checked={skipping}
            onChange={setSkipping}
          />
          <Toggle
            name="allowPartialDaySkip"
            label="Allow single meals, not just whole days"
            hint="Turn off if you cook per day — a lunch-only skip then saves you nothing."
            checked={partial}
            onChange={setPartial}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              name="cutAdvanceHours"
              label="Notice required (hours)"
              hint="0–720. Twelve hours means tonight's dinner must be cut by this morning."
              defaultValue={absence.cutAdvanceHours}
              min={0}
              max={720}
              dimmed={!skipping}
            />
            <NumberField
              name="cutMaxDaysPerMonth"
              label="Days a student may skip per month"
              hint="0–31, counted per calendar month. This is what stops a subscription becoming pay-per-meal."
              defaultValue={absence.cutMaxDaysPerMonth}
              min={0}
              max={31}
              dimmed={!skipping}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Time away</CardTitle>
          <CardDescription>
            A planned absence of several days — going home, a field trip. Deliberately not counted
            against the monthly allowance: a fortnight at home is not over-skipping.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Toggle
            name="allowAwayRequests"
            label="Accept time-away requests"
            hint="Gives the kitchen warning of a large drop in the headcount."
            checked={away}
            onChange={setAway}
          />
          <Toggle
            name="awayRequiresApproval"
            label="Require your approval"
            hint="Off means requests are accepted as soon as they are submitted."
            checked={approval}
            onChange={setApproval}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              name="awayAdvanceHours"
              label="Notice required (hours)"
              hint="0–720. Usually longer than for a single meal — a fortnight away is worth knowing about earlier."
              defaultValue={absence.awayAdvanceHours}
              min={0}
              max={720}
              dimmed={!away}
            />
            <NumberField
              name="awayMaxDays"
              label="Longest single request (days)"
              hint="1–400. A ceiling, so a mistyped date cannot cancel a whole term in one click."
              defaultValue={absence.awayMaxDays}
              min={1}
              max={400}
              dimmed={!away}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Saving…
        </>
      ) : (
        <>
          <Save className="size-4" aria-hidden="true" />
          Save settings
        </>
      )}
    </Button>
  );
}

function SlotRow({ setting }: { setting: SlotSetting }) {
  const [enabled, setEnabled] = useState(setting.enabled);

  return (
    <div className="rounded-lg border p-4">
      <label className="flex cursor-pointer items-center gap-2.5">
        <Checkbox
          name={`enabled_${setting.slot}`}
          checked={enabled}
          onCheckedChange={(v) => setEnabled(v === true)}
        />
        <span className="font-medium">{setting.label}</span>
      </label>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`start_${setting.slot}`} className="text-xs">
            Opens
          </Label>
          <Input
            id={`start_${setting.slot}`}
            name={`start_${setting.slot}`}
            type="time"
            defaultValue={setting.start}
            disabled={!enabled}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`end_${setting.slot}`} className="text-xs">
            Closes
          </Label>
          <Input
            id={`end_${setting.slot}`}
            name={`end_${setting.slot}`}
            type="time"
            defaultValue={setting.end}
            disabled={!enabled}
            className="tabular-nums"
          />
        </div>
      </div>
    </div>
  );
}

export function SettingsForm({
  slots,
  qrTokenTtlSeconds,
  qrRefreshSeconds,
  absence,
}: {
  slots: readonly SlotSetting[];
  qrTokenTtlSeconds: number;
  qrRefreshSeconds: number;
  absence: AbsenceSetting;
}) {
  const [state, formAction] = useActionState<SettingsActionState, FormData>(updateSettings, {});

  return (
    <form action={formAction} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Meal times</CardTitle>
          <CardDescription>
            A QR code is only accepted inside its meal&apos;s window. Untick a meal to stop serving
            it. Windows may not overlap — a student could otherwise be served twice.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {slots.map((setting) => (
            <SlotRow key={setting.slot} setting={setting} />
          ))}
        </CardContent>
      </Card>

      <AbsenceCard absence={absence} />

      <Card>
        <CardHeader>
          <CardTitle>QR rotation</CardTitle>
          <CardDescription>
            How long a code stays valid, and how often the student&apos;s screen redraws it. A short
            life is what stops a screenshot being shared.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="qrTokenTtlSeconds">Code valid for (seconds)</Label>
            <Input
              id="qrTokenTtlSeconds"
              name="qrTokenTtlSeconds"
              type="number"
              min={10}
              max={300}
              defaultValue={qrTokenTtlSeconds}
              className="tabular-nums"
            />
            <p className="text-muted-foreground text-xs">Between 10 and 300.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qrRefreshSeconds">Screen refreshes every (seconds)</Label>
            <Input
              id="qrRefreshSeconds"
              name="qrRefreshSeconds"
              type="number"
              min={1}
              defaultValue={qrRefreshSeconds}
              className="tabular-nums"
            />
            {/* If this were >= the TTL, a student would be holding a dead code
                between redraws and be refused through no fault of their own. */}
            <p className="text-muted-foreground text-xs">
              Must be shorter than how long the code stays valid.
            </p>
          </div>
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

      {state.success ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{state.success}</span>
        </div>
      ) : null}

      <SubmitButton />
    </form>
  );
}
