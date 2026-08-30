"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Plus, XCircle } from "lucide-react";
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
import { assignPlan, endSubscription, type ActionState } from "./actions";

export interface AssignablePlan {
  readonly id: string;
  readonly name: string;
  readonly pricePaise: number;
  readonly durationDays: number;
  readonly mealSlots: readonly string[];
}

function formatRupees(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(paise / 100);
}

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

function Feedback({ state }: { state: ActionState }) {
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

export function AssignPlanDialog({
  studentId,
  plans,
  today,
}: {
  studentId: string;
  plans: readonly AssignablePlan[];
  /** The tenant's current date, computed server-side (never `new Date()` here). */
  today: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    assignPlan.bind(null, studentId),
    {},
  );
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState("");
  const [days, setDays] = useState("");
  const [override, setOverride] = useState("");

  const plan = plans.find((p) => p.id === planId) ?? null;

  // Default to the plan's own term the moment a plan is picked, so the common
  // case — a student buying the whole thing — needs no typing at all.
  const choosePlan = (next: AssignablePlan) => {
    setPlanId(next.id);
    setDays(String(next.durationDays));
    setOverride("");
  };

  const boughtDays = Number(days) || 0;
  const withinPlan = plan !== null && boughtDays >= 1 && boughtDays <= plan.durationDays;

  // Mirrors assignmentPricePaise in the pricing policy: pro-rate per day and
  // round up to the whole rupee, with a full term costing exactly the plan
  // price. Integer arithmetic throughout — this preview must agree with what
  // the server computes, and float division would eventually disagree by a
  // rupee on exactly the amounts nobody checks.
  const calculatedPaise =
    plan === null || !withinPlan
      ? 0
      : boughtDays === plan.durationDays
        ? plan.pricePaise
        : Math.floor(
            (plan.pricePaise * boughtDays + plan.durationDays * 100 - 1) /
              (plan.durationDays * 100),
          ) * 100;

  const overridePaise = override.trim() === "" ? null : Math.round(Number(override) * 100);
  const chargedPaise = overridePaise ?? calculatedPaise;
  const isOverridden = overridePaise !== null && overridePaise !== calculatedPaise;

  if (state.success && open) setOpen(false);

  if (plans.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No active plans exist yet. Create one under Plans before assigning.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Feedback state={state} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button />}>
          <Plus className="size-4" aria-hidden="true" />
          Assign a plan
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <form action={formAction}>
            <DialogHeader>
              <DialogTitle>Assign a plan</DialogTitle>
              <DialogDescription>
                The price and meals are frozen onto this subscription now. A later change to the
                plan will not affect this student.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <input type="hidden" name="planId" value={planId} />
              <div className="space-y-2" role="radiogroup" aria-label="Plan">
                {plans.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={planId === option.id}
                    onClick={() => choosePlan(option)}
                    className={cn(
                      "w-full rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                      "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                      planId === option.id ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                    )}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-medium">{option.name}</span>
                      <span className="tabular-nums">{formatRupees(option.pricePaise)}</span>
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      {option.durationDays} days ·{" "}
                      {option.mealSlots.map((s) => s.toLowerCase()).join(", ")}
                    </span>
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="startDate">Start date</Label>
                <Input
                  id="startDate"
                  name="startDate"
                  type="date"
                  defaultValue={today}
                  className="tabular-nums"
                />
                <p className="text-muted-foreground text-xs">
                  Backdate this if the student has already been eating. The end date is calculated
                  from here.
                </p>
              </div>

              {plan ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="assignmentDurationDays">Days</Label>
                    <Input
                      id="assignmentDurationDays"
                      name="assignmentDurationDays"
                      type="number"
                      min="1"
                      max={plan.durationDays}
                      required
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                      className="tabular-nums"
                    />
                    <p className="text-muted-foreground text-xs">
                      How much of the plan this student is buying. The full {plan.durationDays} days
                      costs {formatRupees(plan.pricePaise)}; fewer days are priced pro rata.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="overrideRupees">Price (₹)</Label>
                    <Input
                      id="overrideRupees"
                      name="overrideRupees"
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={override}
                      onChange={(e) => setOverride(e.target.value)}
                      placeholder={
                        withinPlan
                          ? String(Math.round(calculatedPaise / 100))
                          : "Pick the days first"
                      }
                      className="tabular-nums"
                    />
                    <p className="text-muted-foreground text-xs">
                      Leave blank to charge the calculated price. Anything you type here is charged
                      instead, and recorded as a change.
                    </p>
                  </div>

                  {/* Shown before committing: what the formula says, and what
                      the student will actually be charged if those differ. */}
                  <div className="bg-muted/50 space-y-1.5 rounded-lg border p-3.5 text-sm">
                    {withinPlan ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            {boughtDays === plan.durationDays
                              ? "Full term"
                              : `${boughtDays} of ${plan.durationDays} days`}
                          </span>
                          <span className="tabular-nums">{formatRupees(calculatedPaise)}</span>
                        </div>
                        {isOverridden ? (
                          <div className="flex items-center justify-between border-t pt-1.5">
                            <span className="font-medium">Charged instead</span>
                            <span className="font-medium tabular-nums">
                              {formatRupees(chargedPaise)}
                            </span>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        Enter between 1 and {plan.durationDays} days to see the price.
                      </p>
                    )}
                  </div>
                </>
              ) : null}
            </div>

            <Feedback state={state} />

            <DialogFooter className="pt-4">
              <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
              <Button type="submit" disabled={!planId || !withinPlan}>
                <Submitting idle="Assign plan" busy="Assigning…" />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function EndPlanButton({
  studentId,
  subscriptionId,
  planName,
}: {
  studentId: string;
  subscriptionId: string;
  planName: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    endSubscription.bind(null, studentId),
    {},
  );
  const [open, setOpen] = useState(false);

  if (state.success && open) setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <XCircle className="size-4" aria-hidden="true" />
        End plan
      </DialogTrigger>
      <DialogContent>
        <form action={formAction}>
          <input type="hidden" name="subscriptionId" value={subscriptionId} />
          <DialogHeader>
            <DialogTitle>End {planName}?</DialogTitle>
            <DialogDescription>
              The student can no longer be served under this plan. Attendance already recorded is
              untouched, and no refund is calculated — billing is handled separately.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-4">
            <Label htmlFor="end-reason">Reason</Label>
            <Input
              id="end-reason"
              name="reason"
              required
              minLength={3}
              autoComplete="off"
              placeholder="Switching to the quarterly plan"
            />
            <p className="text-muted-foreground text-xs">Saved to the audit log with your name.</p>
          </div>

          <Feedback state={state} />

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit">
              <Submitting idle="End plan" busy="Ending…" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
