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
}: {
  slots: readonly SlotSetting[];
  qrTokenTtlSeconds: number;
  qrRefreshSeconds: number;
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
