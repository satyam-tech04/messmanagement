"use client";

/**
 * The switch panel for every installed app (D-35).
 *
 * Written to make the dangerous state obvious rather than merely possible to
 * find: live ads say so in red, test mode says what it is doing instead, and
 * the minimum build spells out what raising it does to students on older
 * versions. One save reaches every phone at next launch, and nothing here can
 * be undone by the person it affects.
 */
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateAppConfig, type AppConfigState } from "./actions";

export interface ConfigFormValues {
  readonly adsEnabled: boolean;
  readonly adsTestMode: boolean;
  readonly placements: Record<string, boolean>;
  readonly unitAndroid: string;
  readonly unitIos: string;
  readonly minAppBuild: number;
  readonly currentBuild: number;
}

/** Screen name → what a student is actually looking at there. */
const SCREENS: ReadonlyArray<{ key: string; label: string; note: string }> = [
  {
    key: "qr",
    label: "Meal code",
    note: "Held up at the counter while staff scan it. An accidental tap here is invalid traffic, and enough of it suspends the AdMob account.",
  },
  { key: "menu", label: "Menu", note: "Browsed at leisure. The natural home for a banner." },
  { key: "plan", label: "Plan", note: "Opened occasionally, to check dates." },
  { key: "more", label: "More", note: "Absences and feedback." },
];

function SaveButton() {
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
          Save
        </>
      )}
    </Button>
  );
}

export function ConfigForm({ values }: { values: ConfigFormValues }) {
  const [state, formAction] = useActionState<AppConfigState, FormData>(updateAppConfig, {});

  const [adsEnabled, setAdsEnabled] = useState(values.adsEnabled);
  const [testMode, setTestMode] = useState(values.adsTestMode);
  const [minBuild, setMinBuild] = useState(String(values.minAppBuild));

  const live = adsEnabled && !testMode;
  const blocksCurrent = Number(minBuild) > values.currentBuild;

  return (
    <form action={formAction} className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-medium">Ads</h2>
          <p className="text-muted-foreground text-sm">
            Student screens only. Staff and admins never see ads.
          </p>
        </div>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="adsEnabled"
            className="mt-1 size-4"
            checked={adsEnabled}
            onChange={(e) => setAdsEnabled(e.target.checked)}
          />
          <span className="text-sm">
            <span className="block font-medium">Show ads</span>
            <span className="text-muted-foreground">
              Off means no banner anywhere, whatever the screens below say.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="adsTestMode"
            className="mt-1 size-4"
            checked={testMode}
            onChange={(e) => setTestMode(e.target.checked)}
          />
          <span className="text-sm">
            <span className="block font-medium">Test mode</span>
            <span className="text-muted-foreground">
              Serves Google&rsquo;s test banners instead of your real units. Leave this on until you
              are deliberately earning — tapping your own live ads is invalid traffic.
            </span>
          </span>
        </label>

        {live ? (
          <p
            role="status"
            className="text-destructive flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-50 p-3 text-sm dark:bg-red-950/30"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Live ads. Real students will see real advertising, and every impression is counted
              against your AdMob account.
            </span>
          </p>
        ) : null}

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Screens</legend>
          {SCREENS.map((screen) => (
            <label key={screen.key} className="flex items-start gap-3">
              <input
                type="checkbox"
                name="placements"
                value={screen.key}
                defaultChecked={values.placements[screen.key] ?? false}
                className="mt-1 size-4"
              />
              <span className="text-sm">
                <span className="block font-medium">{screen.label}</span>
                <span className="text-muted-foreground">{screen.note}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="unitAndroid">Android banner unit</Label>
            <Input
              id="unitAndroid"
              name="unitAndroid"
              defaultValue={values.unitAndroid}
              placeholder="ca-app-pub-0000000000000000/0000000000"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unitIos">iOS banner unit</Label>
            <Input
              id="unitIos"
              name="unitIos"
              defaultValue={values.unitIos}
              placeholder="ca-app-pub-0000000000000000/0000000000"
              className="font-mono text-sm"
            />
          </div>
          <p className="text-muted-foreground text-xs sm:col-span-2">
            Ad <strong>unit</strong> ids, with a slash. A tilde means you have pasted the app id,
            which is compiled into the app and cannot be changed from here.
          </p>
        </div>
      </section>

      <section className="space-y-3 border-t pt-6">
        <div>
          <h2 className="text-base font-medium">Minimum app version</h2>
          <p className="text-muted-foreground text-sm">
            Builds below this see a blocking “update to carry on” screen and can do nothing else.
            The current build is {values.currentBuild}.
          </p>
        </div>

        <div className="max-w-40 space-y-2">
          <Label htmlFor="minAppBuild">Minimum build</Label>
          <Input
            id="minAppBuild"
            name="minAppBuild"
            type="number"
            min={0}
            value={minBuild}
            onChange={(e) => setMinBuild(e.target.value)}
            className="tabular-nums"
          />
        </div>

        {blocksCurrent ? (
          <p
            role="status"
            className="text-destructive flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-50 p-3 text-sm dark:bg-red-950/30"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              This is higher than the build that is live ({values.currentBuild}), so it locks out
              every student including anyone on the newest release. They cannot see a menu or show a
              meal code until a higher build reaches the stores.
            </span>
          </p>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <SaveButton />
        {state.error ? (
          <span role="alert" className="text-destructive text-sm">
            {state.error}
          </span>
        ) : null}
        {state.success ? (
          <span role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
            {state.success}
          </span>
        ) : null}
      </div>
    </form>
  );
}
