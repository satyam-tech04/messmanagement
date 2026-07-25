"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { changePassword, type ChangePasswordState } from "./actions";

/** Mirrors the server-side Zod rules. The server remains the authority. */
const RULES = [
  { label: "At least 8 characters", test: (v: string) => v.length >= 8 },
  { label: "Contains a letter", test: (v: string) => /[a-zA-Z]/.test(v) },
  { label: "Contains a number", test: (v: string) => /\d/.test(v) },
];

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending || disabled}
      className="h-12 w-full text-base"
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Saving…
        </>
      ) : (
        "Set password and continue"
      )}
    </Button>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useActionState<ChangePasswordState, FormData>(changePassword, {});
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const failed = RULES.filter((r) => !r.test(password));
  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-rules"
          className="h-12 text-base"
        />
      </div>

      {/* Live checklist rather than an error after submitting — the student is
          on a phone and should not have to guess what "invalid" meant. */}
      <ul id="password-rules" className="space-y-1.5">
        {RULES.map((rule) => {
          const ok = rule.test(password);
          return (
            <li
              key={rule.label}
              className={cn(
                "flex items-center gap-2 text-xs transition-colors",
                ok ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
              )}
            >
              {ok ? (
                <Check className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <span
                  aria-hidden="true"
                  className="size-3.5 shrink-0 rounded-full border border-current opacity-40"
                />
              )}
              <span>{rule.label}</span>
              <span className="sr-only">{ok ? "requirement met" : "requirement not met"}</span>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? "confirm-error" : undefined}
          className="h-12 text-base"
        />
        {mismatch ? (
          <p
            id="confirm-error"
            role="alert"
            className="text-destructive flex items-center gap-1.5 text-xs"
          >
            <X className="size-3.5" aria-hidden="true" />
            The two passwords do not match
          </p>
        ) : null}
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

      <SubmitButton disabled={failed.length > 0 || mismatch || confirm.length === 0} />
    </form>
  );
}
