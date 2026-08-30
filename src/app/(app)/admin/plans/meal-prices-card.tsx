"use client";

/**
 * The rate card, shown above the plans it prices.
 *
 * Deliberately not its own nav entry. These four numbers exist only to suggest
 * a plan's base premium, so they belong beside the plans rather than in
 * Settings, where an admin would have to remember they were there.
 *
 * Only meals the mess actually serves are listed: a breakfast rate for a mess
 * with no breakfast window is a number nobody can use, and plan creation
 * already refuses to include an unserved meal.
 */
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, IndianRupee, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setMealPrice, type MealPriceActionState } from "./meal-price-actions";

const LABELS: Record<string, string> = {
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  SNACKS: "Snacks",
  DINNER: "Dinner",
};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : "Save"}
    </Button>
  );
}

function MealPriceRow({ slot, pricePaise }: { slot: string; pricePaise: number | null }) {
  const [state, formAction] = useActionState(setMealPrice, {} as MealPriceActionState);

  return (
    <form action={formAction} className="flex items-end gap-3">
      <input type="hidden" name="mealSlot" value={slot} />
      <div className="flex-1 space-y-1.5">
        <Label htmlFor={`price-${slot}`} className="text-xs">
          {LABELS[slot] ?? slot}
        </Label>
        <div className="relative">
          <IndianRupee
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            id={`price-${slot}`}
            name="priceRupees"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            className="pl-7"
            defaultValue={pricePaise === null ? "" : (pricePaise / 100).toFixed(2)}
            placeholder="Not set"
          />
        </div>
      </div>
      <SaveButton />
      {state.error ? (
        <span role="alert" className="text-destructive flex items-center gap-1 pb-2.5 text-xs">
          <AlertCircle className="size-3.5" aria-hidden="true" />
          {state.error}
        </span>
      ) : null}
      {state.success ? (
        <span role="status" className="flex items-center gap-1 pb-2.5 text-xs text-emerald-600">
          <Check className="size-3.5" aria-hidden="true" />
          Saved
        </span>
      ) : null}
    </form>
  );
}

export function MealPricesCard({
  servedSlots,
  prices,
}: {
  servedSlots: readonly string[];
  prices: Readonly<Record<string, number>>;
}) {
  if (servedSlots.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Meal prices</CardTitle>
          <CardDescription>What one of each meal is worth.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            This mess has no meal times set yet, so there is nothing to price. Add them under
            Settings first.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meal prices</CardTitle>
        <CardDescription>
          Used to suggest a price when you build a plan. Changing a rate here never affects a plan
          that already exists, or a student already on one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          {servedSlots.map((slot) => (
            <MealPriceRow key={slot} slot={slot} pricePaise={prices[slot] ?? null} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
