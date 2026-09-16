"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Copy, KeyRound, Loader2, UserPlus } from "lucide-react";
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
import { APP_NAME } from "@/lib/app-info";
import { createStaffLogin, resetStaffPassword, type StaffActionState } from "./actions";

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

function Feedback({ state }: { state: StaffActionState }) {
  if (!state.error) return null;
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

/**
 * The credentials, shown once.
 *
 * There is no invitation email: every account in this system is handed over in
 * person, so the screen has to make that hand-over easy and say plainly that it
 * will not be shown again.
 */
function Credentials({ state, name }: { state: StaffActionState; name: string }) {
  const [copied, setCopied] = useState(false);
  if (!state.temporaryPassword) return null;

  return (
    <div className="space-y-3">
      <div className="bg-muted/50 space-y-2 rounded-lg border px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground text-sm">Email</span>
          <span className="font-mono text-sm font-medium break-all">{state.email}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground text-sm">Temporary password</span>
          <span className="font-mono text-sm font-medium tracking-wide">
            {state.temporaryPassword}
          </span>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-50 px-3.5 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Shown <strong>once</strong>. Hand it over before leaving this page — they will be asked to
          choose their own password when they first sign in.
        </span>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(
            `${APP_NAME} staff login\nName: ${name}\nEmail: ${state.email}\nPassword: ${state.temporaryPassword}`,
          );
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? (
          <>
            <Check className="size-4" aria-hidden="true" />
            Copied
          </>
        ) : (
          <>
            <Copy className="size-4" aria-hidden="true" />
            Copy details
          </>
        )}
      </Button>
    </div>
  );
}

export function AddStaffDialog() {
  const [state, formAction] = useActionState<StaffActionState, FormData>(createStaffLogin, {});
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Reopening starts a clean form: the last hand-over must not still be on
        // screen while a different person's details are typed in.
        if (next) setFullName("");
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button />}>
        <UserPlus className="size-4" aria-hidden="true" />
        Add staff
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {state.temporaryPassword ? (
          <>
            <DialogHeader>
              <DialogTitle>{state.success}</DialogTitle>
              <DialogDescription>
                Give them these details. They sign in at the same address everyone else uses.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Credentials state={state} name={fullName} />
            </div>
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>Done</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction}>
            <DialogHeader>
              <DialogTitle>Add a staff login</DialogTitle>
              <DialogDescription>
                Staff can scan meal codes, record manual entries and run counter sales. They cannot
                change students, plans or settings.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="staff-name">Full name</Label>
                <Input
                  id="staff-name"
                  name="fullName"
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="off"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Roshni Patil"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="staff-email">Email</Label>
                <Input
                  id="staff-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="off"
                  placeholder="roshni@yourmess.com"
                />
                <p className="text-muted-foreground text-xs">
                  This is what they type to sign in, so it must be an address they can actually
                  receive mail at — it is how they recover the account later.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="staff-phone">Phone (optional)</Label>
                <Input
                  id="staff-phone"
                  name="phone"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="9876543210"
                />
              </div>

              <Feedback state={state} />
            </div>

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
              <Button type="submit">
                <Submitting idle="Create login" busy="Creating…" />
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ResetStaffPasswordButton({
  profileId,
  fullName,
}: {
  profileId: string;
  fullName: string;
}) {
  const [state, formAction] = useActionState<StaffActionState, FormData>(
    resetStaffPassword.bind(null, profileId),
    {},
  );
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <KeyRound className="size-4" aria-hidden="true" />
        Reset password
      </DialogTrigger>
      <DialogContent>
        {state.temporaryPassword ? (
          <>
            <DialogHeader>
              <DialogTitle>{state.success}</DialogTitle>
              <DialogDescription>
                Their old password no longer works, so hand this over now.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Credentials state={state} name={fullName} />
            </div>
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>Done</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction}>
            <DialogHeader>
              <DialogTitle>Reset {fullName}&apos;s password?</DialogTitle>
              <DialogDescription>
                Issues a new temporary password. They must choose their own when they next sign in,
                and cannot use the counter until they do.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Feedback state={state} />
            </div>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
              <Button type="submit">
                <Submitting idle="Reset password" busy="Resetting…" />
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
