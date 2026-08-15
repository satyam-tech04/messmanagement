"use client";

/**
 * Approve / reject controls for one request.
 *
 * Rejecting opens an inline reason box rather than a dialog: the reason is
 * mandatory, and a form that reveals what it needs is easier to complete than
 * one that accepts a click and then refuses it.
 */
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decideAbsenceRequest, type DecisionActionState } from "./actions";

function Pending({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return pending ? (
    <>
      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      {busy}
    </>
  ) : (
    <>{label}</>
  );
}

export function DecisionButtons({ id }: { id: string }) {
  const [state, formAction] = useActionState<DecisionActionState, FormData>(
    decideAbsenceRequest,
    {},
  );
  const [rejecting, setRejecting] = useState(false);

  return (
    <div className="flex flex-col items-end gap-2">
      {rejecting ? (
        <form action={formAction} className="flex flex-col items-end gap-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="outcome" value="REJECTED" />
          <div className="flex items-center gap-2">
            <Input
              name="reason"
              required
              maxLength={500}
              placeholder="Why? The student sees this."
              className="h-8 w-56 text-sm"
              autoFocus
            />
            <Button type="submit" size="sm" variant="destructive">
              <Pending label="Reject" busy="Rejecting…" />
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <form action={formAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="outcome" value="APPROVED" />
            <Button type="submit" size="sm">
              <Check className="size-3.5" aria-hidden="true" />
              <Pending label="Approve" busy="Approving…" />
            </Button>
          </form>
          <Button type="button" size="sm" variant="outline" onClick={() => setRejecting(true)}>
            <X className="size-3.5" aria-hidden="true" />
            Reject
          </Button>
        </div>
      )}

      {/* Inline, beside the row it concerns — a page-level banner would not say
          which of a dozen requests failed. */}
      {state.error ? (
        <span
          role="alert"
          className="text-destructive flex max-w-xs items-start gap-1.5 text-right text-xs"
        >
          <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          {state.error}
        </span>
      ) : null}
    </div>
  );
}
