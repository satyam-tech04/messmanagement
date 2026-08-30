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
  readonly basePremiumPaise: number;
  readonly discountPaise: number;
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
function PlanFields({
  plan,
  servedSlots,
  mealPrices,
}: {
  plan?: PlanRow;
  servedSlots: readonly string[];
  mealPrices: Readonly<Record<string, number>>;
}) {
  const [durationType, setDurationType] = useState<"MONTHLY" | "QUARTERLY">(
    plan?.durationType ?? "MONTHLY",
  );
  const [durationDays, setDurationDays] = useState(String(plan?.durationDays ?? 30));

  // Slots and money are tracked here rather than left to the DOM because the
  // suggested price depends on both, and it has to move as the admin ticks.
  const [slots, setSlots] = useState<readonly string[]>(plan?.mealSlots ?? []);
  const [basePremium, setBasePremium] = useState(
    plan ? (plan.basePremiumPaise / 100).toFixed(2) : "",
  );
  const [discount, setDiscount] = useState(plan ? (plan.discountPaise / 100).toFixed(2) : "0");

  // The suggestion, in whole paise: summed rates x days. Only a suggestion —
  // whatever the admin saves is what freezes onto the plan.
  const suggestedPaise =
    slots.reduce((sum, slot) => sum + (mealPrices[slot] ?? 0), 0) * (Number(durationDays) || 0);
  const unpricedSlots = slots.filter((slot) => mealPrices[slot] === undefined);

  const basePaise = Math.round((Number(basePremium) || 0) * 100);
  const discountPaise = Math.round((Number(discount) || 0) * 100);
  const finalPaise = basePaise - discountPaise;

  const applySuggestion = () => setBasePremium((suggestedPaise / 100).toFixed(2));

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
          <Label htmlFor="basePremiumRupees">Base premium (₹)</Label>
          <Input
            id="basePremiumRupees"
            name="basePremiumRupees"
            type="number"
            min="0.01"
            step="0.01"
            required
            inputMode="decimal"
            value={basePremium}
            onChange={(e) => setBasePremium(e.target.value)}
            placeholder="4000.00"
          />
          <p className="text-muted-foreground text-xs">
            The full price for the whole period, before any discount.
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
          {MEAL_SLOTS.map((slot) => {
            // A meal with no window cannot be claimed, so offering it would let
            // the admin promise something the counter will always refuse.
            const served = servedSlots.includes(slot.value);
            return (
              <label
                key={slot.value}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm",
                  served ? "hover:bg-muted/50 cursor-pointer" : "cursor-not-allowed opacity-50",
                )}
              >
                <Checkbox
                  name="mealSlots"
                  value={slot.value}
                  disabled={!served}
                  checked={slots.includes(slot.value)}
                  onCheckedChange={(checked) =>
                    setSlots((current) =>
                      checked ? [...current, slot.value] : current.filter((s) => s !== slot.value),
                    )
                  }
                />
                <span className="flex-1">{slot.label}</span>
                {served ? null : (
                  <span className="text-muted-foreground text-[10px]">not served</span>
                )}
              </label>
            );
          })}
        </div>
        <p className="text-muted-foreground text-xs">
          Greyed-out meals have no times set. Add them under Settings first if this plan should
          cover them.
        </p>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="discountRupees">Discount (₹)</Label>
        <Input
          id="discountRupees"
          name="discountRupees"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          placeholder="0.00"
        />
        <p className="text-muted-foreground text-xs">
          A flat amount off the base premium. Leave at zero for no discount.
        </p>
      </div>

      {/* What the meal rates suggest, and what the plan will actually cost.
          Separate lines because they are different things: the suggestion is a
          convenience, the final price is what freezes onto every subscription. */}
      <div className="bg-muted/50 space-y-1.5 rounded-lg border p-3.5 text-sm">
        {suggestedPaise > 0 ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">
              Suggested from meal prices
              {unpricedSlots.length > 0 ? " (some meals unpriced)" : ""}
            </span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums">{formatRupees(suggestedPaise)}</span>
              {basePaise !== suggestedPaise ? (
                <button
                  type="button"
                  onClick={applySuggestion}
                  className="text-primary text-xs underline underline-offset-2"
                >
                  use this
                </button>
              ) : null}
            </span>
          </div>
        ) : slots.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            No meal prices set yet, so there is nothing to suggest — type the base premium yourself.
          </p>
        ) : null}

        <div className="flex items-center justify-between border-t pt-1.5">
          <span className="font-medium">Students pay</span>
          <span className={cn("font-medium tabular-nums", finalPaise <= 0 && "text-destructive")}>
            {finalPaise > 0 ? formatRupees(finalPaise) : "—"}
          </span>
        </div>
        {finalPaise <= 0 ? (
          <p className="text-destructive text-xs">
            The discount cannot be as large as the base premium — the plan would be free.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Paise to a rupee string. Formatting lives at the render boundary, never above it. */
function formatRupees(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(paise / 100);
}

export function CreatePlanDialog({
  servedSlots,
  mealPrices,
}: {
  servedSlots: readonly string[];
  mealPrices: Readonly<Record<string, number>>;
}) {
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

          <PlanFields servedSlots={servedSlots} mealPrices={mealPrices} />
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

export function EditPlanDialog({
  plan,
  servedSlots,
  mealPrices,
}: {
  plan: PlanRow;
  servedSlots: readonly string[];
  mealPrices: Readonly<Record<string, number>>;
}) {
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

          <PlanFields plan={plan} servedSlots={servedSlots} mealPrices={mealPrices} />
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
