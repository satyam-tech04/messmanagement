"use client";

/**
 * The button that moves the operator into another mess.
 *
 * A confirmation dialog rather than a plain button, and the dialog names the
 * mess — DESIGN.md treats "actions that need naming the specific record" as a
 * confirmation case, and this one qualifies twice over: the next thing the
 * operator does after switching is edit a real hostel's students, and by then
 * the sidebar looks identical to the one they just left.
 */
import { useActionState, useState } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { switchMess, type SwitchMessState } from "./actions";

export function SwitchMessButton({
  tenantId,
  tenantName,
  studentCount,
}: {
  tenantId: string;
  tenantName: string;
  studentCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<SwitchMessState, FormData>(switchMess, {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <ArrowRightLeft className="size-4" aria-hidden="true" />
            Switch
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Switch to {tenantName}?</DialogTitle>
          <DialogDescription>
            Every admin screen will show {tenantName}&rsquo;s data, including its{" "}
            {studentCount === 1 ? "1 student" : `${studentCount} students`}. Anything you change
            there is that hostel&rsquo;s live data. The switch is recorded in their audit trail.
          </DialogDescription>
        </DialogHeader>

        {state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}

        <form action={formAction}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Switching…
                </>
              ) : (
                <>Switch to {tenantName}</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
