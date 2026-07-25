"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { clearMenu, publishMenu, type MenuActionState } from "./actions";

export interface MenuCell {
  readonly serviceDate: string;
  readonly slot: string;
  readonly slotLabel: string;
  readonly window: string;
  readonly items: readonly string[];
  readonly notes: string | null;
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

export function EditMenuDialog({
  cell,
  dateLabel,
}: {
  cell: MenuCell;
  /** Human-readable date, formatted server-side in the tenant's timezone. */
  dateLabel: string;
}) {
  const [state, formAction] = useActionState<MenuActionState, FormData>(publishMenu, {});
  const [open, setOpen] = useState(false);
  const isPublished = cell.items.length > 0 || Boolean(cell.notes);

  if (state.success && open) setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant={isPublished ? "ghost" : "outline"} size="sm" />}
        aria-label={`${isPublished ? "Edit" : "Add"} ${cell.slotLabel} menu for ${dateLabel}`}
      >
        {isPublished ? (
          <>
            <Pencil className="size-3.5" aria-hidden="true" />
            Edit
          </>
        ) : (
          <>
            <Plus className="size-3.5" aria-hidden="true" />
            Add
          </>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form action={formAction}>
          <input type="hidden" name="serviceDate" value={cell.serviceDate} />
          <input type="hidden" name="mealSlot" value={cell.slot} />

          <DialogHeader>
            <DialogTitle>
              {cell.slotLabel} · {dateLabel}
            </DialogTitle>
            <DialogDescription>
              Served {cell.window}. Students see this as soon as you publish.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor={`items-${cell.slot}-${cell.serviceDate}`}>Items</Label>
              {/* A textarea rather than repeatable rows: the kitchen types this
                  on a phone, and one-per-line is far quicker than tapping "add". */}
              <textarea
                id={`items-${cell.slot}-${cell.serviceDate}`}
                name="items"
                rows={7}
                defaultValue={cell.items.join("\n")}
                placeholder={"Rice\nDal Tadka\nPaneer Butter Masala\nSalad"}
                className="border-input focus-visible:ring-ring/50 aria-invalid:border-destructive w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
              />
              <p className="text-muted-foreground text-xs">
                One item per line. Blank lines and repeats are removed automatically.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`notes-${cell.slot}-${cell.serviceDate}`}>Note (optional)</Label>
              <Input
                id={`notes-${cell.slot}-${cell.serviceDate}`}
                name="notes"
                defaultValue={cell.notes ?? ""}
                placeholder="Special Sunday lunch"
                maxLength={500}
              />
              <p className="text-muted-foreground text-xs">
                If nothing is being served, leave the items empty and say why here.
              </p>
            </div>
          </div>

          {state.error ? (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm dark:text-red-300"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{state.error}</span>
            </div>
          ) : null}

          <DialogFooter className="pt-4">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit">
              <Submitting idle="Publish" busy="Publishing…" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ClearMenuButton({ cell, dateLabel }: { cell: MenuCell; dateLabel: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function run() {
    setPending(true);
    setError(null);
    const result = await clearMenu(cell.serviceDate, cell.slot as never);
    setPending(false);
    if (result.error) setError(result.error);
    else setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="sm" />}
        aria-label={`Clear ${cell.slotLabel} menu for ${dateLabel}`}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Clear</span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Clear the {cell.slotLabel.toLowerCase()} menu for {dateLabel}?
          </DialogTitle>
          <DialogDescription>
            Students will see &ldquo;not published yet&rdquo; for this meal. Attendance is
            unaffected — a missing menu does not stop anyone being served.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
          <Button onClick={run} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Clearing…
              </>
            ) : (
              "Clear menu"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PublishedTick() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
      <Check className="size-3.5" aria-hidden="true" />
      Published
    </span>
  );
}
