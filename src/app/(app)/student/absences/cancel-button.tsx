"use client";

/**
 * Withdrawing an absence.
 *
 * Its own form rather than a row of buttons in one big form, so a pending state
 * belongs to the row that was clicked and the student can see which of several
 * requests is being withdrawn.
 */
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelAbsence, type AbsenceActionState } from "./actions";

function Inner() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" size="sm" disabled={pending}>
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Undo2 className="size-3.5" aria-hidden="true" />
      )}
      {pending ? "Withdrawing…" : "Withdraw"}
    </Button>
  );
}

export function CancelButton({ id }: { id: string }) {
  const [state, formAction] = useActionState<AbsenceActionState, FormData>(cancelAbsence, {});

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <Inner />
      {/* Inline, next to the row it concerns — a banner at the top of the page
          would not say which request failed to withdraw. */}
      {state.error ? (
        <span role="alert" className="text-destructive max-w-[16rem] text-right text-xs">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
