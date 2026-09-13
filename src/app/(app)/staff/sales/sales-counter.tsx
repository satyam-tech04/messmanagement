"use client";

/**
 * The counter screen.
 *
 * Built for somebody standing at a till with a queue: the open bills are always
 * visible, switching between them is one tap, and the search box is focused so
 * an item can be found by typing rather than scrolling.
 *
 * Deliberately one screen rather than a list page and a detail page. Spec §4
 * requires switching freely between bills with nothing to finish first, and a
 * navigation round trip between every plate would make that unusable.
 */
import { useActionState, useMemo, useOptimistic, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertCircle,
  CircleCheck,
  Clock,
  Loader2,
  Minus,
  Plus,
  Receipt,
  Search,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  billTotalPaise,
  matchesItemSearch,
  type BillLine,
} from "@/core/policies/counter-sales.policy";
import { toPaise } from "@/core/money";
import { cn } from "@/lib/utils";
import {
  addBillLine,
  cancelBill,
  createBill,
  finalizeBill,
  removeBillLine,
  setLineQuantity,
  type SaleActionState,
} from "./actions";

export interface CounterItemRow {
  readonly id: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly unit: string;
  readonly pricePaise: number;
}

export interface OpenBill {
  readonly id: string;
  readonly billNumber: string;
  readonly personName: string;
  readonly lines: readonly {
    readonly id: string;
    readonly counterItemId: string;
    readonly itemCodeSnapshot: string;
    readonly itemNameSnapshot: string;
    readonly unitSnapshot: string;
    readonly unitPricePaise: number;
    readonly quantity: number;
  }[];
}

function rupees(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(paise / 100);
}

/** The policy's own total, so the screen and the receipt cannot disagree. */
function totalOf(lines: OpenBill["lines"]): number {
  return billTotalPaise(
    lines.map((l): BillLine => ({
      id: l.id,
      counterItemId: l.counterItemId,
      itemCodeSnapshot: l.itemCodeSnapshot,
      itemNameSnapshot: l.itemNameSnapshot,
      unitSnapshot: l.unitSnapshot,
      unitPricePaise: toPaise(l.unitPricePaise),
      quantity: l.quantity,
    })),
  );
}

function Feedback({ state }: { state: SaleActionState }) {
  if (state.error) {
    return (
      <div
        role="alert"
        className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm dark:text-red-300"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{state.error}</span>
      </div>
    );
  }
  return null;
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

// ---------------------------------------------------------------------------

function NewBillDialog() {
  const [state, formAction] = useActionState(createBill, {} as SaleActionState);
  const [open, setOpen] = useState(false);
  if (state.success && open) setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="w-full" />}>
        <UserPlus className="size-4" aria-hidden="true" />
        New bill
      </DialogTrigger>
      <DialogContent>
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Start a bill</DialogTitle>
            <DialogDescription>
              A name so you can tell this bill from the others. It is not linked to any student
              account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="personName">Name</Label>
              <Input id="personName" name="personName" required autoFocus placeholder="Ramesh" />
            </div>
            <Feedback state={state} />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit">
              <Submitting idle="Start bill" busy="Starting…" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  billId,
  billNumber,
  total,
  kind,
}: {
  billId: string;
  billNumber: string;
  total: number;
  kind: "FINALIZE" | "CANCEL";
}) {
  const action = kind === "FINALIZE" ? finalizeBill : cancelBill;
  const [state, formAction] = useActionState(action.bind(null, billId), {} as SaleActionState);
  const [open, setOpen] = useState(false);
  // Paid by default: at a cash counter the money usually changes hands as the
  // bill is closed (D-29). Reset on every open, so one unpaid bill does not
  // quietly make the next one unpaid too.
  const [payment, setPayment] = useState<"PAID" | "UNPAID">("PAID");
  if (state.success && open) setOpen(false);

  const finalising = kind === "FINALIZE";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPayment("PAID");
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant={finalising ? "default" : "outline"}
            className={finalising ? "flex-1" : ""}
          />
        }
      >
        {finalising ? (
          <>
            <Receipt className="size-4" aria-hidden="true" />
            Finalise
          </>
        ) : (
          <>
            <X className="size-4" aria-hidden="true" />
            Cancel bill
          </>
        )}
      </DialogTrigger>
      <DialogContent>
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>
              {finalising ? `Finalise ${billNumber}?` : `Cancel ${billNumber}?`}
            </DialogTitle>
            <DialogDescription>
              {finalising
                ? "Once finalised, the bill can no longer be edited."
                : "The bill is kept as a record but is excluded from the day's takings. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-muted/50 flex items-center justify-between rounded-lg border p-4">
              <span className="text-muted-foreground text-sm">Total</span>
              <span className="text-xl font-semibold tabular-nums">{rupees(total)}</span>
            </div>
            {finalising ? (
              <div className="space-y-2">
                <input type="hidden" name="paymentStatus" value={payment} />
                <p id={`payment-${billId}`} className="text-sm font-medium">
                  Payment
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby={`payment-${billId}`}
                  className="grid grid-cols-2 gap-2"
                >
                  {(
                    [
                      { value: "PAID", label: "Paid", hint: "Money received now" },
                      { value: "UNPAID", label: "Unpaid", hint: "To be collected later" },
                    ] as const
                  ).map((option) => {
                    const selected = payment === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setPayment(option.value)}
                        className={cn(
                          "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                          "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                          selected
                            ? option.value === "PAID"
                              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                              : "border-amber-500 bg-amber-50 dark:bg-amber-950/40"
                            : "hover:bg-muted/50",
                        )}
                      >
                        {option.value === "PAID" ? (
                          <CircleCheck
                            className={cn(
                              "mt-0.5 size-4 shrink-0",
                              selected ? "text-emerald-600" : "text-muted-foreground",
                            )}
                            aria-hidden="true"
                          />
                        ) : (
                          <Clock
                            className={cn(
                              "mt-0.5 size-4 shrink-0",
                              selected ? "text-amber-600" : "text-muted-foreground",
                            )}
                            aria-hidden="true"
                          />
                        )}
                        <span>
                          <span className="block font-medium">{option.label}</span>
                          <span className="text-muted-foreground block text-xs">{option.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <Feedback state={state} />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {finalising ? "Keep editing" : "Keep the bill"}
            </DialogClose>
            <Button type="submit" variant={finalising ? "default" : "destructive"}>
              <Submitting
                idle={
                  finalising
                    ? payment === "PAID"
                      ? "Finalise as paid"
                      : "Finalise as unpaid"
                    : "Cancel bill"
                }
                busy={finalising ? "Finalising…" : "Cancelling…"}
              />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LineRow({ line }: { line: OpenBill["lines"][number] }) {
  const [removeState, removeAction] = useActionState(removeBillLine, {} as SaleActionState);
  const [qtyState, qtyAction] = useActionState(setLineQuantity, {} as SaleActionState);
  const formRef = useRef<HTMLFormElement>(null);

  // Optimistic so tapping + on a queue of five people feels instant; the server
  // is still the authority and a rejected change snaps back on revalidate.
  const [shownQuantity, setShownQuantity] = useOptimistic(line.quantity);

  const submitQuantity = (next: number) => {
    if (next < 1) return;
    setShownQuantity(next);
    const form = formRef.current;
    if (!form) return;
    (form.elements.namedItem("quantity") as HTMLInputElement).value = String(next);
    form.requestSubmit();
  };

  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{line.itemNameSnapshot}</p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {rupees(line.unitPricePaise)} / {line.unitSnapshot} · {line.itemCodeSnapshot}
        </p>
      </div>

      <form action={qtyAction} ref={formRef} className="flex items-center gap-1">
        <input type="hidden" name="lineId" value={line.id} />
        <input type="hidden" name="quantity" defaultValue={line.quantity} />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-8"
          aria-label={`One fewer ${line.itemNameSnapshot}`}
          disabled={shownQuantity <= 1}
          onClick={() => submitQuantity(shownQuantity - 1)}
        >
          <Minus className="size-3.5" aria-hidden="true" />
        </Button>
        <span className="w-7 text-center text-sm font-medium tabular-nums">{shownQuantity}</span>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-8"
          aria-label={`One more ${line.itemNameSnapshot}`}
          onClick={() => submitQuantity(shownQuantity + 1)}
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </Button>
      </form>

      <span className="w-20 text-right text-sm font-medium tabular-nums">
        {rupees(line.unitPricePaise * shownQuantity)}
      </span>

      <form action={removeAction}>
        <input type="hidden" name="lineId" value={line.id} />
        <Button
          type="submit"
          size="icon"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive size-8"
          aria-label={`Remove ${line.itemNameSnapshot}`}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </Button>
      </form>

      {removeState.error || qtyState.error ? (
        <span role="alert" className="text-destructive text-xs">
          {removeState.error ?? qtyState.error}
        </span>
      ) : null}
    </li>
  );
}

function AddItemPanel({ billId, items }: { billId: string; items: readonly CounterItemRow[] }) {
  const [state, formAction] = useActionState(addBillLine, {} as SaleActionState);
  const [query, setQuery] = useState("");

  // One field for both code and name, matched by the same function the tests
  // cover. Blank shows everything, which is the default the spec asks for.
  const matches = useMemo(
    () =>
      items.filter((i) => matchesItemSearch({ itemCode: i.itemCode, itemName: i.itemName }, query)),
    [items, query],
  );

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or code"
          className="pl-9"
          aria-label="Search items"
        />
      </div>

      <Feedback state={state} />

      {items.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          No items on the counter list yet. An admin adds them under Counter sales → Items.
        </p>
      ) : matches.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">Nothing matches “{query}”.</p>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto">
          {matches.map((item) => (
            <li key={item.id}>
              <form action={formAction}>
                <input type="hidden" name="billId" value={billId} />
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="quantity" value="1" />
                <button
                  type="submit"
                  className={cn(
                    "hover:bg-muted/60 flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors",
                    "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.itemName}</span>
                    <span className="text-muted-foreground text-xs">
                      {item.itemCode} · {item.unit}
                    </span>
                  </span>
                  <span className="tabular-nums">{rupees(item.pricePaise)}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SalesCounter({
  bills,
  items,
  takingsTodayPaise,
  billsToday,
}: {
  bills: readonly OpenBill[];
  items: readonly CounterItemRow[];
  takingsTodayPaise: number;
  billsToday: number;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(bills[0]?.id ?? null);

  // A bill finalised in another tab disappears from `bills` on revalidate; fall
  // back to the first open one rather than showing an empty pane.
  const selected = bills.find((b) => b.id === selectedId) ?? bills[0] ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <div className="space-y-4">
        <NewBillDialog />

        <Card>
          <CardContent className="space-y-1 py-4">
            <p className="text-muted-foreground text-xs">Finalised today</p>
            <p className="text-2xl font-semibold tabular-nums">{rupees(takingsTodayPaise)}</p>
            <p className="text-muted-foreground text-xs">
              {billsToday === 1 ? "1 bill" : `${billsToday} bills`}
            </p>
          </CardContent>
        </Card>

        {bills.length === 0 ? (
          <div className="border-border rounded-lg border border-dashed px-4 py-10 text-center">
            <Receipt className="text-muted-foreground mx-auto mb-3 size-6" aria-hidden="true" />
            <p className="text-sm font-medium">No open bills</p>
            <p className="text-muted-foreground mt-1 text-xs">Start one when somebody orders.</p>
          </div>
        ) : (
          <ul className="space-y-1.5" aria-label="Open bills">
            {bills.map((b) => {
              const total = totalOf(b.lines);
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(b.id)}
                    aria-current={selected?.id === b.id}
                    className={cn(
                      "w-full rounded-lg border px-3.5 py-3 text-left transition-colors",
                      "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                      selected?.id === b.id ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{b.personName}</span>
                      <span className="text-sm tabular-nums">{rupees(total)}</span>
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">
                      {b.billNumber} · {b.lines.length === 1 ? "1 item" : `${b.lines.length} items`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selected ? (
        <Card>
          <CardContent className="space-y-5 py-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{selected.personName}</h2>
                <p className="text-muted-foreground text-xs tabular-nums">{selected.billNumber}</p>
              </div>
              <p className="text-2xl font-semibold tabular-nums">
                {rupees(totalOf(selected.lines))}
              </p>
            </div>

            {selected.lines.length === 0 ? (
              <p className="text-muted-foreground border-y py-8 text-center text-sm">
                Nothing on this bill yet. Add something below.
              </p>
            ) : (
              <ul className="divide-y border-y">
                {selected.lines.map((line) => (
                  <LineRow key={line.id} line={line} />
                ))}
              </ul>
            )}

            <AddItemPanel billId={selected.id} items={items} />

            <div className="flex gap-2 border-t pt-4">
              <ConfirmDialog
                billId={selected.id}
                billNumber={selected.billNumber}
                total={totalOf(selected.lines)}
                kind="FINALIZE"
              />
              <ConfirmDialog
                billId={selected.id}
                billNumber={selected.billNumber}
                total={totalOf(selected.lines)}
                kind="CANCEL"
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-20 text-center">
            <Receipt className="text-muted-foreground size-8" aria-hidden="true" />
            <div>
              <p className="font-medium">No bill selected</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Start a bill to begin taking an order.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
