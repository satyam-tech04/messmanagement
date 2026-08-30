"use client";

/**
 * The admin's pause controls.
 *
 * Spec §20 wants the calculated grace days shown *before* the admin confirms,
 * and §7 wants the end date pre-filled but still theirs to change. Both happen
 * live in the form below rather than on a separate confirmation screen: the
 * admin sees "6 days paused, plan now ends 16 Oct" update as they pick dates,
 * which is the same information a confirmation step would show, one screen
 * earlier and without a round trip.
 *
 * The end-date field is deliberately pre-filled rather than read-only. The
 * moment an admin types their own value the summary says so, so an override is
 * never silent in either direction.
 */
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CalendarOff, Check, Loader2, Pause, Play, X } from "lucide-react";
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
import { StatusBadge } from "@/components/status-badge";
import { addDays, differenceInDays, isServiceDate, toServiceDate } from "@/core/time";
import { formatServiceDate } from "@/lib/format";
import { cancelScheduledPause, resumeEarly, savePause } from "./pause-actions";
import type { ActionState } from "./actions";

export interface CurrentPause {
  readonly startDate: string;
  readonly resumeDate: string;
  readonly endDateBeforePause: string;
  readonly remarks: string;
  readonly state: "SCHEDULED" | "RUNNING" | "COMPLETED" | "CANCELLED";
  readonly graceDays: number;
}

/**
 * Date arithmetic for the live preview, borrowed from the domain rather than
 * rewritten here.
 *
 * `src/core/time` is pure and has no React or Supabase in it, so a client
 * component may import it — and must. The first draft of this file did the
 * arithmetic by hand with `toISOString().slice(0, 10)`, which
 * `timezone-discipline.test.ts` rejected on sight. It was right to: the preview
 * must agree with what the server will compute, and the only way to guarantee
 * that is to run the same functions.
 *
 * The guards exist because a half-typed `<input type="date">` yields values
 * like "2026-09" that `toServiceDate` would throw on.
 */
function daysBetween(from: string, to: string): number {
  if (!isServiceDate(from) || !isServiceDate(to)) return 0;
  return differenceInDays(toServiceDate(from), toServiceDate(to));
}

function addDaysTo(date: string, days: number): string {
  if (!isServiceDate(date)) return date;
  return addDays(toServiceDate(date), days);
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

function Feedback({ state }: { state: ActionState }) {
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

// ---------------------------------------------------------------------------

export function PauseDialog({
  studentId,
  today,
  planEndDate,
  existing,
}: {
  studentId: string;
  today: string;
  planEndDate: string;
  existing: CurrentPause | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(savePause.bind(null, studentId), {} as ActionState);

  const [startDate, setStartDate] = useState(existing?.startDate ?? "");
  const [resumeDate, setResumeDate] = useState(existing?.resumeDate ?? "");
  const [endDate, setEndDate] = useState("");

  // The anchor: on a modify, the end date as it stood before this pause ever
  // moved it. Using the plan's *current* end date here would show the admin an
  // extension stacked on top of the one they already applied.
  const anchor = existing?.endDateBeforePause ?? planEndDate;

  const graceDays = useMemo(
    () => (startDate && resumeDate ? Math.max(0, daysBetween(startDate, resumeDate)) : 0),
    [startDate, resumeDate],
  );
  const computedEnd = useMemo(
    () => (graceDays > 0 ? addDaysTo(anchor, graceDays) : anchor),
    [anchor, graceDays],
  );

  // Empty means "accept the computed value" — the server applies the same rule,
  // so an untouched field and a field typed to match behave identically.
  const effectiveEnd = endDate || computedEnd;
  const overridden = Boolean(endDate) && endDate !== computedEnd;
  const valid = graceDays > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={existing ? "outline" : "default"} size="sm">
            <Pause className="size-4" aria-hidden="true" />
            {existing ? "Change pause" : "Pause plan"}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>{existing ? "Change the pause" : "Pause this plan"}</DialogTitle>
            <DialogDescription>
              The student keeps their login but cannot get a meal while the plan is paused. The days
              they lose are added to the end of the plan.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startDate">First day paused</Label>
                <Input
                  id="startDate"
                  name="startDate"
                  type="date"
                  required
                  min={today}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="resumeDate">First day back</Label>
                <Input
                  id="resumeDate"
                  name="resumeDate"
                  type="date"
                  required
                  min={startDate || today}
                  value={resumeDate}
                  onChange={(e) => setResumeDate(e.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  They eat again on this day — it is not a paused day.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subscriptionEndDate">Plan now ends</Label>
              <Input
                id="subscriptionEndDate"
                name="subscriptionEndDate"
                type="date"
                min={resumeDate || today}
                placeholder={computedEnd}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Leave blank to use the calculated date. Anything you type here is kept as entered.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="remarks">Reason</Label>
              <textarea
                id="remarks"
                name="remarks"
                required
                minLength={3}
                maxLength={500}
                rows={2}
                defaultValue={existing?.remarks ?? ""}
                placeholder="Gone home for a wedding"
                className="border-input focus-visible:ring-ring/50 aria-invalid:border-destructive w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
              />
            </div>

            {/* §20: the calculated figures, before the admin commits. */}
            <div className="bg-muted/50 space-y-1.5 rounded-lg border p-3.5 text-sm">
              {valid ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Days paused</span>
                    <span className="font-medium tabular-nums">
                      {graceDays === 1 ? "1 day" : `${graceDays} days`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Plan ends</span>
                    <span className="font-medium tabular-nums">
                      {formatServiceDate(effectiveEnd)}
                    </span>
                  </div>
                  {overridden ? (
                    <p className="text-muted-foreground pt-1 text-xs">
                      You have changed this from the calculated {formatServiceDate(computedEnd)}.
                      Your date will be used.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">
                  Pick both dates to see how many days will be paused.
                </p>
              )}
            </div>

            <Feedback state={state} />
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!valid}>
              <Submitting idle={existing ? "Save changes" : "Pause plan"} busy="Saving…" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function ResumeEarlyButton({
  studentId,
  today,
  scheduledResume,
}: {
  studentId: string;
  today: string;
  scheduledResume: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(resumeEarly.bind(null, studentId), {} as ActionState);
  const [resumeOn, setResumeOn] = useState(today);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Play className="size-4" aria-hidden="true" />
            Resume early
          </Button>
        }
      />
      <DialogContent>
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Resume this plan early</DialogTitle>
            <DialogDescription>
              The student came back sooner than expected. Only the days they were actually away are
              added to the end of the plan — the rest are given back.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="resumeOn">First day back</Label>
              <Input
                id="resumeOn"
                name="resumeOn"
                type="date"
                required
                max={scheduledResume}
                value={resumeOn}
                onChange={(e) => setResumeOn(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Was scheduled for {formatServiceDate(scheduledResume)}.
              </p>
            </div>
            <Feedback state={state} />
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit">
              <Submitting idle="Resume now" busy="Resuming…" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function CancelPauseButton({ studentId }: { studentId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    cancelScheduledPause.bind(null, studentId),
    {} as ActionState,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <X className="size-4" aria-hidden="true" />
            Cancel pause
          </Button>
        }
      />
      <DialogContent>
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Cancel this pause?</DialogTitle>
            <DialogDescription>
              The plan goes back to exactly what it was — same end date, no days added. The student
              keeps eating as normal.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Feedback state={state} />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Keep it</DialogClose>
            <Button type="submit" variant="destructive">
              <Submitting idle="Cancel pause" busy="Cancelling…" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

/** The pause section on the student's plan card. */
export function PauseSection({
  studentId,
  today,
  planEndDate,
  pause,
}: {
  studentId: string;
  today: string;
  planEndDate: string;
  pause: CurrentPause | null;
}) {
  const live = pause && (pause.state === "SCHEDULED" || pause.state === "RUNNING") ? pause : null;

  return (
    <div className="border-border mt-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CalendarOff className="text-muted-foreground size-4" aria-hidden="true" />
            <h4 className="text-sm font-medium">Pause</h4>
            {live ? (
              <StatusBadge status={live.state === "RUNNING" ? "PAUSED" : "PAUSE SCHEDULED"} />
            ) : null}
          </div>
          {live ? (
            <p className="text-muted-foreground text-sm">
              {live.state === "RUNNING" ? "Paused since " : "Paused from "}
              <span className="tabular-nums">{formatServiceDate(live.startDate)}</span>, back on{" "}
              <span className="tabular-nums">{formatServiceDate(live.resumeDate)}</span> —{" "}
              {live.graceDays === 1 ? "1 day" : `${live.graceDays} days`}.
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              Not paused. Pausing stops meals and adds the missed days to the end of the plan.
            </p>
          )}
          {live?.remarks ? (
            <p className="text-muted-foreground text-sm italic">“{live.remarks}”</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PauseDialog
            studentId={studentId}
            today={today}
            planEndDate={planEndDate}
            existing={live}
          />
          {live?.state === "RUNNING" ? (
            <ResumeEarlyButton
              studentId={studentId}
              today={today}
              scheduledResume={live.resumeDate}
            />
          ) : null}
          {live?.state === "SCHEDULED" ? <CancelPauseButton studentId={studentId} /> : null}
        </div>
      </div>
    </div>
  );
}
