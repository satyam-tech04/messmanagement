"use client";

import { useState, type ReactNode } from "react";
import { Keyboard, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const SLOTS = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"] as const;

/**
 * The audited manual fallback (§6.4).
 *
 * Deliberately **not** a bypass: the server runs the identical eligibility
 * checks as a QR scan, so a blocked student is refused here too. What it
 * bypasses is the *camera* — a dead phone, a cracked screen, a scanner that
 * cannot focus.
 *
 * The reason is mandatory because these are precisely the rows that get
 * questioned later: "why does the log say 40 manual entries on Tuesday?"
 */
export function ManualEntryDialog({
  onSubmit,
  deviceId,
  trigger,
  prefillRoll,
}: {
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
  deviceId: string;
  trigger?: ReactNode;
  prefillRoll?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [rollNumber, setRollNumber] = useState(prefillRoll ?? "");
  const [mealSlot, setMealSlot] = useState<(typeof SLOTS)[number]>("LUNCH");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = rollNumber.trim().length > 0 && reason.trim().length >= 3 && !busy;

  async function submit() {
    setBusy(true);
    await onSubmit({
      mode: "MANUAL",
      rollNumber: rollNumber.trim(),
      mealSlot,
      reason: reason.trim(),
      deviceId,
    });
    setBusy(false);
    setOpen(false);
    setRollNumber("");
    setReason("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ? <span /> : <Button variant="outline" size="sm" />}>
        {trigger ?? (
          <>
            <Keyboard className="size-4" aria-hidden="true" />
            Manual entry
          </>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Serve without scanning</DialogTitle>
          <DialogDescription>
            For a dead phone or a code that will not scan. The same checks still apply — a blocked
            student is refused here too.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="manual-roll">Roll number</Label>
            <Input
              id="manual-roll"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="CS21B001"
              // Large target: typed one-handed at a counter, often in a hurry.
              className="h-12 font-mono text-base"
            />
          </div>

          <div className="space-y-2">
            <Label>Meal</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Meal">
              {SLOTS.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  role="radio"
                  aria-checked={mealSlot === slot}
                  onClick={() => setMealSlot(slot)}
                  className={cn(
                    "rounded-lg border px-4 py-2.5 text-sm capitalize transition-colors",
                    "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                    mealSlot === slot
                      ? "border-primary bg-primary/5 font-medium"
                      : "hover:bg-muted/50",
                  )}
                >
                  {slot.toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual-reason">Reason</Label>
            <Input
              id="manual-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Phone battery dead"
              className="h-12 text-base"
            />
            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Recorded in the audit log with your name and this device.
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? "Serving…" : "Serve student"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
