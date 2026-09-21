"use client";

/**
 * Erase / cancel controls for one deletion request.
 *
 * Erasing asks for the word ERASE to be typed. Everywhere else in this app a
 * destructive action is one click away because everything else can be undone —
 * a status can be changed back, an absence re-approved. This one cannot, and
 * the row above it looks exactly like every other row.
 */
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decideAccountDeletion, type DeletionActionState } from "./actions";

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

export function DecisionButtons({ id, name }: { id: string; name: string }) {
  const [state, formAction] = useActionState<DeletionActionState, FormData>(
    decideAccountDeletion,
    {},
  );
  const [mode, setMode] = useState<"idle" | "erase" | "cancel">("idle");

  return (
    <div className="flex flex-col items-end gap-2">
      {mode === "erase" ? (
        <form action={formAction} className="flex flex-col items-end gap-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="outcome" value="COMPLETE" />
          <div className="flex items-center gap-2">
            <Input
              name="confirm"
              required
              autoFocus
              placeholder="Type ERASE"
              aria-label={`Type ERASE to erase ${name}`}
              className="h-8 w-32 text-sm"
            />
            <Input
              name="note"
              maxLength={500}
              placeholder="How you verified them"
              className="h-8 w-48 text-sm"
            />
            <Button type="submit" size="sm" variant="destructive">
              <Pending label="Erase" busy="Erasing…" />
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
              Back
            </Button>
          </div>
        </form>
      ) : mode === "cancel" ? (
        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="outcome" value="CANCEL" />
          <Input
            name="note"
            required
            autoFocus
            maxLength={500}
            placeholder="Why? Kept in the log."
            className="h-8 w-56 text-sm"
          />
          <Button type="submit" size="sm">
            <Pending label="Restore" busy="Restoring…" />
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
            Back
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setMode("cancel")}>
            <Undo2 className="size-3.5" aria-hidden="true" />
            Restore
          </Button>
          <Button type="button" size="sm" variant="destructive" onClick={() => setMode("erase")}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            Erase
          </Button>
        </div>
      )}

      {state.error ? (
        <span role="alert" className="text-destructive flex items-center gap-1 text-right text-xs">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          {state.error}
        </span>
      ) : null}
      {state.success ? (
        <span role="status" className="text-muted-foreground max-w-64 text-right text-xs">
          {state.success}
        </span>
      ) : null}
    </div>
  );
}
