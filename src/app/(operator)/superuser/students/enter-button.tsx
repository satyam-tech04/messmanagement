"use client";

/**
 * "Enter as" with a confirmation that names the student.
 *
 * The next thing that happens is the operator holding a real student's live
 * meal QR, so this is a naming-the-record confirmation (DESIGN.md), not a
 * plain button.
 */
import { useActionState, useState } from "react";
import { Loader2, LogIn } from "lucide-react";
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
import { enterAsStudent, type EnterAsStudentState } from "../actions";

export function EnterAsStudentButton({
  profileId,
  fullName,
  rollNumber,
  tenantName,
}: {
  profileId: string;
  fullName: string;
  rollNumber: string;
  tenantName: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<EnterAsStudentState, FormData>(
    enterAsStudent,
    {},
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <LogIn className="size-4" aria-hidden="true" />
            Enter as
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enter as {fullName}?</DialogTitle>
          <DialogDescription>
            {`You will see ${tenantName} exactly as ${fullName} (roll ${rollNumber}) does, including their live meal QR. Their phone stays signed in. The visit is recorded in ${tenantName}’s audit trail and ends after two hours or when you press Exit.`}
          </DialogDescription>
        </DialogHeader>

        {state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <form action={formAction}>
            <input type="hidden" name="profileId" value={profileId} />
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogIn className="size-4" aria-hidden="true" />
              )}
              {pending ? "Entering…" : `Enter as ${fullName.split(" ")[0]}`}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
