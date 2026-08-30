"use client";

/**
 * Catalogue forms.
 *
 * The item code is never editable. It is stamped onto every bill line the item
 * has ever appeared on, so reassigning it would make an old receipt describe a
 * different thing (spec §15).
 */
import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Pencil, Plus } from "lucide-react";
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
import {
  createCounterItem,
  setCounterItemActive,
  updateCounterItem,
  type CounterItemActionState,
} from "./actions";

export interface CounterItemRow {
  readonly id: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly unit: string;
  readonly pricePaise: number;
  readonly isActive: boolean;
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

function Feedback({ state }: { state: CounterItemActionState }) {
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

function ItemFields({ item }: { item?: CounterItemRow }) {
  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="itemName">Item</Label>
        <Input
          id="itemName"
          name="itemName"
          required
          defaultValue={item?.itemName}
          placeholder="Masala Dosa"
          autoComplete="off"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="unit">Unit</Label>
          <Input
            id="unit"
            name="unit"
            required
            defaultValue={item?.unit}
            placeholder="Plate"
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">Shown on every bill line.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="priceRupees">Price (₹)</Label>
          <Input
            id="priceRupees"
            name="priceRupees"
            type="number"
            min="0.01"
            step="0.01"
            required
            inputMode="decimal"
            defaultValue={item ? (item.pricePaise / 100).toFixed(2) : ""}
            placeholder="60.00"
          />
        </div>
      </div>
    </div>
  );
}

export function CreateItemDialog() {
  const [state, formAction] = useActionState(createCounterItem, {} as CounterItemActionState);
  const [open, setOpen] = useState(false);
  if (state.success && open) setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="size-4" aria-hidden="true" />
        Add item
      </DialogTrigger>
      <DialogContent>
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Add a counter item</DialogTitle>
            <DialogDescription>
              A code is assigned automatically and never changes, so old bills always describe the
              right thing.
            </DialogDescription>
          </DialogHeader>
          <ItemFields />
          <Feedback state={state} />
          <DialogFooter className="pt-4">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit">
              <Submitting idle="Add item" busy="Adding…" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditItemDialog({ item }: { item: CounterItemRow }) {
  const [state, formAction] = useActionState(
    updateCounterItem.bind(null, item.id),
    {} as CounterItemActionState,
  );
  const [open, setOpen] = useState(false);
  if (state.success && open) setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil className="size-4" aria-hidden="true" />
        Edit
      </DialogTrigger>
      <DialogContent>
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Edit {item.itemCode}</DialogTitle>
            <DialogDescription>
              Bills that already include this item keep the name and price they were made with. Only
              new bills use the new values.
            </DialogDescription>
          </DialogHeader>
          <ItemFields item={item} />
          <Feedback state={state} />
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

export function ToggleItemButton({ itemId, isActive }: { itemId: string; isActive: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setCounterItemActive(itemId, !isActive);
            setError(result.error ?? null);
          })
        }
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : isActive ? (
          "Hide"
        ) : (
          "Restore"
        )}
      </Button>
      {error ? (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      ) : null}
    </>
  );
}
