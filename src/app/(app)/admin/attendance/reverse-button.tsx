"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Undo2 } from "lucide-react";
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
import { reverseAttendance, type ReversalState } from "./actions";

function Submitting() {
  const { pending } = useFormStatus();
  return <>{pending ? "Correcting…" : "Correct this record"}</>;
}

/**
 * Undo a mistaken scan.
 *
 * Deliberately worded as a *correction*, not a deletion — nothing is removed,
 * and the original scan stays visible alongside the reason it was reversed.
 */
export function ReverseAttendanceButton({
  attendanceId,
  rollNumber,
  fullName,
  mealLabel,
}: {
  attendanceId: string;
  rollNumber: string;
  fullName: string;
  mealLabel: string;
}) {
  const [state, formAction] = useActionState<ReversalState, FormData>(reverseAttendance, {});
  const [open, setOpen] = useState(false);

  if (state.success && open) setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="sm" />}
        aria-label={`Correct ${mealLabel} for ${rollNumber}`}
      >
        <Undo2 className="size-3.5" aria-hidden="true" />
        Correct
      </DialogTrigger>

      <DialogContent>
        <form action={formAction}>
          <input type="hidden" name="attendanceId" value={attendanceId} />
          <DialogHeader>
            <DialogTitle>
              Correct {mealLabel} for {fullName}?
            </DialogTitle>
            <DialogDescription>
              Use this when the wrong student was served — a mistyped roll number, or the wrong
              person waved through. The meal stops counting toward the headcount, and this student
              can be served again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-4">
            <Label htmlFor={`reason-${attendanceId}`}>What went wrong?</Label>
            <Input
              id={`reason-${attendanceId}`}
              name="reason"
              required
              minLength={3}
              autoComplete="off"
              placeholder="Scanned CS21B004 by mistake"
            />
            {/* Nothing is deleted, so the record and this reason both remain. */}
            <p className="text-muted-foreground text-xs">
              The original scan is kept and marked corrected, with your name and this reason.
            </p>
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

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit">
              <Submitting />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
