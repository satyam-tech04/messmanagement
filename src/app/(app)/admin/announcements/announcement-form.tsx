"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Megaphone, Pencil } from "lucide-react";
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
import { saveAnnouncement, setAnnouncementArchived, type AnnouncementActionState } from "./actions";

export interface AnnouncementRow {
  readonly id: string;
  readonly title: string;
  readonly body: string | null;
  readonly serviceDate: string | null;
  readonly mealSlot: string | null;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly state: "SCHEDULED" | "LIVE" | "FINISHED" | "ARCHIVED";
}

const SLOTS = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"] as const;

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

function Feedback({ state }: { state: AnnouncementActionState }) {
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

function Fields({ announcement, today }: { announcement?: AnnouncementRow; today: string }) {
  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          required
          maxLength={120}
          defaultValue={announcement?.title}
          placeholder="Onam Sadhya"
          autoComplete="off"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="body">What is being served</Label>
        <textarea
          id="body"
          name="body"
          rows={3}
          maxLength={2000}
          defaultValue={announcement?.body ?? ""}
          placeholder="Payasam, avial, thoran, sambar, rice, papad."
          className="border-input focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
        />
        <p className="text-muted-foreground text-xs">Optional. A title on its own is enough.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="serviceDate">Day of the meal</Label>
          <Input
            id="serviceDate"
            name="serviceDate"
            type="date"
            defaultValue={announcement?.serviceDate ?? ""}
            className="tabular-nums"
          />
          <p className="text-muted-foreground text-xs">Optional.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="mealSlot">Meal</Label>
          <select
            id="mealSlot"
            name="mealSlot"
            defaultValue={announcement?.mealSlot ?? ""}
            className="border-input focus-visible:ring-ring/50 h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          >
            <option value="">Any</option>
            {SLOTS.map((slot) => (
              <option key={slot} value={slot}>
                {slot.charAt(0) + slot.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="startsOn">Show from</Label>
          <Input
            id="startsOn"
            name="startsOn"
            type="date"
            required
            defaultValue={announcement?.startsOn ?? today}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endsOn">Show until</Label>
          <Input
            id="endsOn"
            name="endsOn"
            type="date"
            required
            defaultValue={announcement?.endsOn ?? today}
            className="tabular-nums"
          />
          <p className="text-muted-foreground text-xs">
            Included — it still shows on this day, then stops on its own.
          </p>
        </div>
      </div>
    </div>
  );
}

export function CreateAnnouncementDialog({ today }: { today: string }) {
  const [state, formAction] = useActionState(
    saveAnnouncement.bind(null, null),
    {} as AnnouncementActionState,
  );
  const [open, setOpen] = useState(false);
  if (state.success && open) setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Megaphone className="size-4" aria-hidden="true" />
        New announcement
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Post an announcement</DialogTitle>
            <DialogDescription>
              Every student in this mess sees it on their own screen while it is showing. Nothing is
              booked or counted — they simply come to the mess.
            </DialogDescription>
          </DialogHeader>
          <Fields today={today} />
          <Feedback state={state} />
          <DialogFooter className="pt-4">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit">
              <Submitting idle="Post it" busy="Posting…" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditAnnouncementDialog({
  announcement,
  today,
}: {
  announcement: AnnouncementRow;
  today: string;
}) {
  const [state, formAction] = useActionState(
    saveAnnouncement.bind(null, announcement.id),
    {} as AnnouncementActionState,
  );
  const [open, setOpen] = useState(false);
  if (state.success && open) setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil className="size-4" aria-hidden="true" />
        Edit
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Edit announcement</DialogTitle>
            <DialogDescription>
              Changes reach every student&apos;s screen the next time they open the app.
            </DialogDescription>
          </DialogHeader>
          <Fields announcement={announcement} today={today} />
          <Feedback state={state} />
          <DialogFooter className="pt-4">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit">
              <Submitting idle="Save changes" busy="Saving…" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const result = await setAnnouncementArchived(id, !archived);
          setError(result.error ?? null);
          setPending(false);
        }}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : archived ? (
          "Show again"
        ) : (
          "Withdraw"
        )}
      </Button>
      {error ? (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      ) : null}
    </>
  );
}
