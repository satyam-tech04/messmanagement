"use client";

import { useCallback, useState } from "react";
import { AlertCircle, Check, Keyboard, Loader2, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  refineScanAction,
  scanOutcomeFor,
  scanTitleFor,
  type ScanDetails,
  type ScanOutcome,
} from "@/lib/scan-outcome";

interface VerifyResponse {
  readonly ok: boolean;
  readonly code: string;
  readonly message?: string;
  readonly rollNumber?: string;
  readonly fullName?: string;
  readonly auditFailed?: boolean;
  readonly details?: ScanDetails;
  readonly mealSlot?: string;
}

const TONE_PANEL: Record<string, string> = {
  success: "border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/40",
  warning: "border-amber-500/40 bg-amber-50 dark:bg-amber-950/40",
  danger: "border-red-500/40 bg-red-50 dark:bg-red-950/40",
  info: "border-sky-500/40 bg-sky-50 dark:bg-sky-950/40",
  neutral: "border-border bg-muted/40",
};

/**
 * Manual entry as a full screen (§6.4).
 *
 * The same flow exists as a dialog on the scanner, for when a scan fails
 * mid-queue. This standalone page is for the counter that has no working camera
 * at all — a cracked tablet, a denied permission — where opening the scanner
 * first just to reach a dialog would be a pointless extra step.
 *
 * It is **not** a bypass: the server runs the identical eligibility checks, so a
 * blocked student is refused here too.
 */
export function ManualPageClient({
  deviceId,
  servedSlots,
  timeZone,
}: {
  deviceId: string;
  servedSlots: readonly { slot: string; label: string; window: string }[];
  timeZone: string;
}) {
  const [rollNumber, setRollNumber] = useState("");
  const [mealSlot, setMealSlot] = useState(servedSlots[0]?.slot ?? "LUNCH");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    outcome: ScanOutcome;
    title: string;
    action: string;
    response: VerifyResponse;
  } | null>(null);

  const canSubmit = rollNumber.trim().length > 0 && reason.trim().length >= 3 && !busy;

  const submit = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/qr/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "MANUAL",
          rollNumber: rollNumber.trim(),
          mealSlot,
          reason: reason.trim(),
          deviceId,
        }),
      });
      const data = (await response.json()) as VerifyResponse;
      const slot =
        data.mealSlot ?? (typeof data.details?.slot === "string" ? data.details.slot : undefined);
      setResult({
        outcome: scanOutcomeFor(data.ok ? "SERVED" : data.code),
        title: scanTitleFor(data.ok ? "SERVED" : data.code, slot),
        action: refineScanAction(data.code, data.details ?? null, timeZone),
        response: data,
      });
      if (data.ok) {
        // Clear only on success, so a refused entry can be corrected and retried
        // without retyping everything.
        setRollNumber("");
        setReason("");
      }
    } catch {
      setResult({
        outcome: scanOutcomeFor("INFRASTRUCTURE_ERROR"),
        title: scanOutcomeFor("INFRASTRUCTURE_ERROR").title,
        action: scanOutcomeFor("INFRASTRUCTURE_ERROR").action,
        response: { ok: false, code: "INFRASTRUCTURE_ERROR" },
      });
    } finally {
      setBusy(false);
    }
  }, [rollNumber, mealSlot, reason, deviceId, timeZone]);

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="space-y-2">
            <Label htmlFor="roll">Roll number</Label>
            <Input
              id="roll"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) void submit();
              }}
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="CS21B001"
              // Large targets throughout: this is used standing up, one-handed,
              // with a queue waiting.
              className="h-14 font-mono text-lg"
            />
            <p className="text-muted-foreground text-xs">
              Case does not matter — <span className="font-mono">cs21b001</span> finds{" "}
              <span className="font-mono">CS21B001</span>.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Meal</Label>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Meal">
              {servedSlots.map((s) => (
                <button
                  key={s.slot}
                  type="button"
                  role="radio"
                  aria-checked={mealSlot === s.slot}
                  onClick={() => setMealSlot(s.slot)}
                  className={cn(
                    "rounded-lg border px-4 py-3 text-left transition-colors",
                    "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                    mealSlot === s.slot
                      ? "border-primary bg-primary/5 font-medium"
                      : "hover:bg-muted/50",
                  )}
                >
                  <span className="block text-sm">{s.label}</span>
                  <span className="text-muted-foreground block text-xs tabular-nums">
                    {s.window}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) void submit();
              }}
              placeholder="Phone battery dead"
              className="h-12 text-base"
            />
            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Recorded in the audit log with your name and this device. Admins review manual
              entries.
            </p>
          </div>

          <Button
            onClick={() => void submit()}
            disabled={!canSubmit}
            size="lg"
            className="h-12 w-full text-base"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Serving…
              </>
            ) : (
              <>
                <Keyboard className="size-4" aria-hidden="true" />
                Serve student
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {result ? (
        <div
          role="status"
          aria-live="assertive"
          className={cn(
            "space-y-2 rounded-xl border p-5 text-center",
            TONE_PANEL[result.outcome.tone] ?? TONE_PANEL.danger,
          )}
        >
          <div className="flex justify-center">
            {result.response.ok ? (
              <Check className="size-8 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            ) : (
              <X className="size-8 text-red-600 dark:text-red-400" aria-hidden="true" />
            )}
          </div>

          <p className="text-lg font-semibold">{result.title}</p>

          {result.response.ok ? (
            <p className="text-sm">
              <span className="font-medium">{result.response.fullName}</span>
              <span className="text-muted-foreground font-mono">
                {" "}
                · {result.response.rollNumber}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              {result.response.message ?? result.action}
            </p>
          )}

          <p className="text-sm font-medium">{result.action}</p>

          {result.response.auditFailed ? (
            <p className="flex items-start justify-center gap-1.5 text-xs">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Recorded, but not written to the audit log. Tell the mess admin.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
