"use client";

/**
 * The one thing a student can send into this app.
 *
 * Kept as light as the rest of their screen: pick a meal, tap a star, optionally
 * say something and attach a photo. No account, no thread, no reply — the mess
 * reads it and that is the end of it.
 */
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Camera, Check, Loader2, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { submitFeedback, type FeedbackActionState } from "./actions";

export interface FeedbackTarget {
  readonly serviceDate: string;
  readonly mealSlot: string;
  readonly label: string;
  readonly existingRating: number | null;
  readonly existingComment: string | null;
}

function SubmitButton({ hasRating }: { hasRating: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={!hasRating || pending} className="w-full">
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Sending…
        </>
      ) : (
        "Send feedback"
      )}
    </Button>
  );
}

export function FeedbackForm({ targets }: { targets: readonly FeedbackTarget[] }) {
  const [state, formAction] = useActionState(submitFeedback, {} as FeedbackActionState);
  const [selected, setSelected] = useState(0);
  const [rating, setRating] = useState(targets[0]?.existingRating ?? 0);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const target = targets[selected];
  if (!target) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-muted-foreground text-sm">
            Nothing to review yet. Come back after a meal.
          </p>
        </CardContent>
      </Card>
    );
  }

  const choose = (index: number) => {
    setSelected(index);
    setRating(targets[index]?.existingRating ?? 0);
    setPhotoName(null);
    if (photoRef.current) photoRef.current.value = "";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>How was it?</CardTitle>
        <CardDescription>
          The mess reads this. It does not affect your plan, your QR code or anything else.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          <input type="hidden" name="serviceDate" value={target.serviceDate} />
          <input type="hidden" name="mealSlot" value={target.mealSlot} />
          <input type="hidden" name="rating" value={rating} />

          <div className="space-y-2">
            <Label>Which meal</Label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Which meal">
              {targets.map((t, i) => (
                <button
                  key={`${t.serviceDate}-${t.mealSlot}`}
                  type="button"
                  role="radio"
                  aria-checked={selected === i}
                  onClick={() => choose(i)}
                  className={cn(
                    "rounded-lg border px-3.5 py-2 text-sm transition-colors",
                    "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                    selected === i
                      ? "border-primary bg-primary/5 font-medium"
                      : "hover:bg-muted/50",
                  )}
                >
                  {t.label}
                  {t.existingRating ? " ✓" : ""}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label id="rating-label">Your rating</Label>
            <div className="flex gap-1.5" role="radiogroup" aria-labelledby="rating-label">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  role="radio"
                  aria-checked={rating === star}
                  aria-label={`${star} out of 5`}
                  onClick={() => setRating(star)}
                  className="focus-visible:ring-ring/50 rounded p-1 focus-visible:ring-[3px] focus-visible:outline-none"
                >
                  <Star
                    className={cn(
                      "size-8 transition-colors",
                      star <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
                    )}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comment">Anything to add</Label>
            <textarea
              id="comment"
              name="comment"
              rows={3}
              maxLength={1000}
              defaultValue={target.existingComment ?? ""}
              placeholder="The dal was cold today."
              className="border-input focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="photo">Photo</Label>
            <input
              ref={photoRef}
              id="photo"
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="sr-only"
              onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? null)}
            />
            {photoName ? (
              <div className="flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm">
                <Camera className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{photoName}</span>
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => {
                    setPhotoName(null);
                    if (photoRef.current) photoRef.current.value = "";
                  }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => photoRef.current?.click()}
              >
                <Camera className="size-4" aria-hidden="true" />
                Add a photo
              </Button>
            )}
            <p className="text-muted-foreground text-xs">
              Optional, up to 3 MB. Only the mess office can see it.
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
          {state.success ? (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{state.success}</span>
            </div>
          ) : null}

          <SubmitButton hasRating={rating > 0} />
          {target.existingRating ? (
            <p className="text-muted-foreground text-center text-xs">
              You already rated this meal {target.existingRating}/5. Sending again replaces it.
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
