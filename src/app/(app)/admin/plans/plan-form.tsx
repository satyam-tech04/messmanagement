"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Archive, Check, Loader2, Pencil, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { createPlan, setPlanActive, updatePlan, type PlanActionState } from "./actions";

export interface PlanRow {
  readonly id: string;
  readonly name: string;
  readonly pricePaise: number;
  readonly durationType: "MONTHLY" | "QUARTERLY";
  readonly durationDays: number;
  readonly mealSlots: readonly string[];
  readonly isActive: boolean;
  readonly subscriberCount: number;
}

const MEAL_SLOTS = [
  { value: "BREAKFAST", label: "Breakfast" },
  { value: "LUNCH", label: "Lunch" },
  { value: "SNACKS", label: "Snacks" },
  { value: "DINNER", label: "Dinner" },
] as const;

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

function ErrorBar({ state }: { state: PlanActionState }) {
  if (!state.error) return null;
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

/** Shared body for create and edit, so the two forms cannot drift apart. */
function PlanFields({ plan }: { plan?: PlanRow }) {
  const [durationType, setDurationType] = useState<"MONTHLY" | "QUARTERLY">(
    plan?.durationType ?? "MONTHLY",
  );
  const [durationDays, setDurationDays] = useState(String(plan?.durationDays ?? 30));

  return (
    <div className="space-y-5 py-4">
      <div className="space-y-2">
        <Label htmlFor="name">Plan name</Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={plan?.name}
          placeholder="Monthly — Lunch & Dinner"
          autoComplete="off"
        />
        <p className="text-muted-foreground text-xs">
          Shown to students and in the plan picker. Must be unique.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="priceRupees">Price (₹)</Label>
          <Input
            id="priceRupees"
            name="priceRupees"
            type="number"
            min="0"
            step="0.01"
            required
            inputMode="decimal"
            defaultValue={plan ? (plan.pricePaise / 100).toFixed(2) : ""}
            placeholder="4000.00"
          />
          <p className="text-muted-foreground text-xs">
            The full price for the whole period, not per meal.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="durationDays">Duration (days)</Label>
          <Input
            id="durationDays"
            name="durationDays"
            type="number"
            min="1"
            max="400"
            required
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Counted inclusively — 30 days starting the 1st ends on the 30th.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Billing cycle</Label>
        <input type="hidden" name="durationType" value={durationType} />
        <div className="flex gap-2" role="radiogroup" aria-label="Billing cycle">
          {(
            [
              { value: "MONTHLY", label: "Monthly", days: "30" },
              { value: "QUARTERLY", label: "Quarterly", days: "90" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={durationType === option.value}
              onClick={() => {
                setDurationType(option.value);
                setDurationDays(option.days);
              }}
              className={cn(
                "flex-1 rounded-lg border px-4 py-2.5 text-sm transition-colors",
                "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                durationType === option.value
                  ? "border-primary bg-primary/5 font-medium"
                  : "hover:bg-muted/50",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Meals included</legend>
        <div className="grid grid-cols-2 gap-2">
          {MEAL_SLOTS.map((slot) => (
            <label
              key={slot.value}
              className="hover:bg-muted/50 flex cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm"
            >
              <Checkbox
                name="mealSlots"
                value={slot.value}
                defaultChecked={plan?.mealSlots.includes(slot.value)}
              />
              {slot.label}
            </label>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          Only these meals can be claimed at the counter under this plan.
        </p>
      </fieldset>
    </div>
  );
}

export function CreatePlanDialog() {
  const [state, formAction] = useActionState<PlanActionState, FormData>(createPlan, {});
  const [open, setOpen] = useState(false);

  // Closing on success keeps the dialog from sitting over the row it just
  // created, which is the first thing the admin wants to see.
  if (state.success && open) setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="size-4" aria-hidden="true" />
        New plan
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>New plan</DialogTitle>
            <DialogDescription>
              Students are assigned a plan to gain QR access. The price is frozen onto each
              subscription at the moment it is assigned.
            </DialogDescription>
          </DialogHeader>

          <PlanFields />
          <ErrorBar state={state} />

          <DialogFooter className="pt-4">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit">
              <Submitting idle="Create plan" busy="Creating…" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditPlanDialog({ plan }: { plan: PlanRow }) {
  const [state, formAction] = useActionState<PlanActionState, FormData>(
    updatePlan.bind(null, plan.id),
    {},
  );
  const [open, setOpen] = useState(false);

  if (state.success && open) setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Pencil className="size-4" aria-hidden="true" />
        Edit
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Edit {plan.name}</DialogTitle>
            <DialogDescription>
              {plan.subscriberCount > 0 ? (
                <>
                  {plan.subscriberCount} student{plan.subscriberCount === 1 ? " is" : "s are"}{" "}
                  currently on this plan. They keep the price they were given — changing it here
                  affects new assignments only.
                </>
              ) : (
                "No students are on this plan yet."
              )}
            </DialogDescription>
          </DialogHeader>

          <PlanFields plan={plan} />
          <ErrorBar state={state} />

          <DialogFooter className="pt-4">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit">
              <Submitting idle="Save changes" busy="Saving…" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TogglePlanButton({ plan }: { plan: PlanRow }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function toggle() {
    setPending(true);
    setError(null);
    const result = await setPlanActive(plan.id, !plan.isActive);
    setPending(false);
    if (result.error) setError(result.error);
    else setOpen(false);
  }

  if (plan.isActive) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="ghost" size="sm" />}>
          <Archive className="size-4" aria-hidden="true" />
          Retire
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retire {plan.name}?</DialogTitle>
            <DialogDescription>
              It disappears from the plan picker so nobody new can be assigned it.
              {plan.subscriberCount > 0 ? (
                <>
                  {" "}
                  The {plan.subscriberCount} student
                  {plan.subscriberCount === 1 ? "" : "s"} already on it keep their plan until it
                  expires — retiring is not the same as cancelling.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button onClick={toggle} disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Retiring…
                </>
              ) : (
                "Retire plan"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Button variant="ghost" size="sm" onClick={toggle} disabled={pending}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <RotateCcw className="size-4" aria-hidden="true" />
      )}
      Restore
    </Button>
  );
}

export function SuccessToast({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    >
      <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
