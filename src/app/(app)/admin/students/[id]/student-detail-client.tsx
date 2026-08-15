"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Save,
  ShieldAlert,
  Upload,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import {
  removeStudentPhoto,
  resetStudentPassword,
  updateStudentDetails,
  updateStudentStatus,
  uploadStudentPhoto,
  type ActionState,
} from "./actions";

export interface StudentDetail {
  readonly id: string;
  readonly rollNumber: string;
  readonly status: "ACTIVE" | "GRACE" | "BLOCKED" | "INACTIVE";
  readonly fullName: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly block: string | null;
  readonly roomNumber: string | null;
}

/** Mirrors the state machine in `src/core/domain/enums.ts` (§2.6). */
const LEGAL_TRANSITIONS: Record<StudentDetail["status"], readonly StudentDetail["status"][]> = {
  ACTIVE: ["GRACE", "BLOCKED", "INACTIVE"],
  GRACE: ["ACTIVE", "BLOCKED", "INACTIVE"],
  BLOCKED: ["ACTIVE", "INACTIVE"],
  INACTIVE: ["ACTIVE"],
};

const STATUS_CONSEQUENCE: Record<StudentDetail["status"], string> = {
  ACTIVE: "They can scan their QR code and be served at the counter.",
  GRACE: "They can still be served, but the mess owner is being warned about dues.",
  BLOCKED: "Their QR code will be refused at the counter until this is lifted.",
  INACTIVE: "They can no longer sign in or be served. Use this when a student leaves.",
};

function Pending({ idle, busy }: { idle: React.ReactNode; busy: string }) {
  const { pending } = useFormStatus();
  return pending ? (
    <>
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {busy}
    </>
  ) : (
    idle
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

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// --- Edit details ---------------------------------------------------------

export function EditDetailsCard({ student }: { student: StudentDetail }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    updateStudentDetails.bind(null, student.id),
    {},
  );
  const err = state.fieldErrors ?? {};

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>
          The roll number is the student&apos;s login and cannot be changed.
        </CardDescription>
      </CardHeader>
      <form action={formAction} noValidate>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="fullName" label="Full name" error={err.fullName}>
              <Input
                id="fullName"
                name="fullName"
                defaultValue={student.fullName}
                required
                aria-invalid={Boolean(err.fullName) || undefined}
              />
            </Field>

            <Field id="rollNumber" label="Roll number">
              <Input
                id="rollNumber"
                value={student.rollNumber}
                readOnly
                disabled
                className="font-mono"
              />
            </Field>

            <Field id="phone" label="Phone" error={err.phone}>
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                defaultValue={student.phone ?? ""}
                aria-invalid={Boolean(err.phone) || undefined}
              />
            </Field>

            <Field id="email" label="Email" error={err.email}>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={student.email ?? ""}
                aria-invalid={Boolean(err.email) || undefined}
              />
            </Field>

            <Field id="block" label="Block" error={err.block}>
              <Input id="block" name="block" defaultValue={student.block ?? ""} />
            </Field>

            <Field id="roomNumber" label="Room number" error={err.roomNumber}>
              <Input id="roomNumber" name="roomNumber" defaultValue={student.roomNumber ?? ""} />
            </Field>
          </div>

          <Feedback state={state} />

          <div>
            <Button type="submit">
              <Pending
                idle={
                  <>
                    <Save className="size-4" aria-hidden="true" />
                    Save changes
                  </>
                }
                busy="Saving…"
              />
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}

// --- Status ---------------------------------------------------------------

export function StatusCard({ student }: { student: StudentDetail }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    updateStudentStatus.bind(null, student.id),
    {},
  );
  const [target, setTarget] = useState<StudentDetail["status"] | null>(null);
  const options = LEGAL_TRANSITIONS[student.status];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Status</CardTitle>
        <CardDescription>
          Controls whether this student can be served at the counter.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={student.status} />
          <p className="text-muted-foreground text-sm">{STATUS_CONSEQUENCE[student.status]}</p>
        </div>

        <Feedback state={state} />

        <div className="flex flex-wrap gap-2">
          {options.map((next) => (
            <Dialog
              key={next}
              open={target === next}
              onOpenChange={(open) => setTarget(open ? next : null)}
            >
              <DialogTrigger
                render={
                  <Button
                    variant={next === "BLOCKED" || next === "INACTIVE" ? "outline" : "default"}
                    size="sm"
                    className={cn(
                      next === "BLOCKED" &&
                        "border-red-500/40 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40",
                    )}
                  />
                }
              >
                Mark as {next.toLowerCase()}
              </DialogTrigger>

              <DialogContent>
                <form action={formAction}>
                  <input type="hidden" name="status" value={next} />
                  <DialogHeader>
                    <DialogTitle>
                      Mark {student.fullName} as {next.toLowerCase()}?
                    </DialogTitle>
                    <DialogDescription>{STATUS_CONSEQUENCE[next]}</DialogDescription>
                  </DialogHeader>

                  <div className="space-y-2 py-4">
                    <Label htmlFor={`reason-${next}`}>Reason</Label>
                    <Input
                      id={`reason-${next}`}
                      name="reason"
                      required
                      minLength={3}
                      autoComplete="off"
                      placeholder={
                        next === "BLOCKED" ? "Dues unpaid for July" : "Left the hostel on 30 Jul"
                      }
                    />
                    {/* Recorded verbatim in the audit log — this is what answers
                        "why was I blocked?" three months from now. */}
                    <p className="text-muted-foreground text-xs">
                      Saved to the audit log with your name and the time.
                    </p>
                  </div>

                  <DialogFooter>
                    <DialogClose render={<Button type="button" variant="ghost" />}>
                      Cancel
                    </DialogClose>
                    <Button type="submit">
                      <Pending idle={<>Confirm</>} busy="Saving…" />
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ))}
        </div>

        {student.status === "INACTIVE" ? (
          <p className="text-muted-foreground text-xs">
            An inactive student can only be re-activated. Blocking is for unpaid dues, which no
            longer applies once they have left.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// --- Reset password -------------------------------------------------------

export function ResetPasswordCard({ student }: { student: StudentDetail }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    resetStudentPassword.bind(null, student.id),
    {},
  );
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Issues a new temporary password. The student must change it when they next sign in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.temporaryPassword ? (
          <div className="space-y-3">
            <div className="bg-muted/50 flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
              <span className="text-muted-foreground text-sm">New temporary password</span>
              <span className="font-mono text-sm font-medium tracking-wide">
                {state.temporaryPassword}
              </span>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-50 px-3.5 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Shown <strong>once</strong>. Their old password no longer works, so hand this over
                before leaving the page.
              </span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(
                  `Mess OS login\nRoll number: ${student.rollNumber}\nPassword: ${state.temporaryPassword}`,
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
        ) : null}

        <Feedback state={state} />

        {!state.temporaryPassword ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button variant="outline" />}>
              <KeyRound className="size-4" aria-hidden="true" />
              Reset password
            </DialogTrigger>
            <DialogContent>
              <form action={formAction}>
                <DialogHeader>
                  <DialogTitle>Reset {student.fullName}&apos;s password?</DialogTitle>
                  <DialogDescription>
                    Their current password stops working immediately. They will not be able to sign
                    in until you hand them the new one.
                  </DialogDescription>
                </DialogHeader>

                <div className="flex items-start gap-2.5 py-4 text-sm">
                  <ShieldAlert
                    className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">
                    Do this only with the student present or reachable. This is recorded in the
                    audit log.
                  </span>
                </div>

                <DialogFooter>
                  <DialogClose render={<Button type="button" variant="ghost" />}>
                    Cancel
                  </DialogClose>
                  <Button type="submit">
                    <Pending idle={<>Reset password</>} busy="Resetting…" />
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </CardContent>
    </Card>
  );
}

// --- Photo ----------------------------------------------------------------

/**
 * The face staff see at the counter (§6.3).
 *
 * The QR proves possession of a phone, not identity — without this, a student
 * can hand their phone to a friend and nobody at the counter can tell.
 */
export function PhotoCard({ student, hasPhoto }: { student: StudentDetail; hasPhoto: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    uploadStudentPhoto.bind(null, student.id),
    {},
  );
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState(false);
  const showing = hasPhoto && !removed;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Photo</CardTitle>
        <CardDescription>
          Shown to staff when this student is served, so they can check the phone belongs to the
          person holding it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="bg-muted flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border">
            {showing ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/students/${student.id}/photo`}
                alt={`${student.fullName}`}
                className="size-full object-cover"
              />
            ) : (
              <UserRound className="text-muted-foreground size-8" aria-hidden="true" />
            )}
          </div>

          <form action={formAction} className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="photo" className="sr-only">
              Photo
            </Label>
            <Input
              id="photo"
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm">
                <Pending
                  idle={
                    <>
                      <Upload className="size-4" aria-hidden="true" />
                      {showing ? "Replace photo" : "Upload photo"}
                    </>
                  }
                  busy="Uploading…"
                />
              </Button>
              {showing ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={removing}
                  onClick={async () => {
                    setRemoving(true);
                    const result = await removeStudentPhoto(student.id);
                    setRemoving(false);
                    if (!result.error) setRemoved(true);
                  }}
                >
                  {removing ? "Removing…" : "Remove"}
                </Button>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">JPEG, PNG or WebP, up to 2 MB.</p>
          </form>
        </div>

        <Feedback state={state} />
      </CardContent>
    </Card>
  );
}
