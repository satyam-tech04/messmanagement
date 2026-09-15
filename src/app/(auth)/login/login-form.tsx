"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      className="aurora-fill aurora-glow h-12 w-full rounded-xl text-base font-bold hover:opacity-90"
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Signing in…
        </>
      ) : (
        <>
          <LogIn className="size-4" aria-hidden="true" />
          Sign in
        </>
      )}
    </Button>
  );
}

export function LoginForm({ next, appOnly = false }: { next?: string; appOnly?: boolean }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="space-y-2">
        <Label htmlFor="identifier">{appOnly ? "Email" : "Email or mobile number"}</Label>
        <Input
          id="identifier"
          name="identifier"
          type="text"
          required
          autoFocus
          // `email` once the website is admin-only. Before that, `text`: a
          // student typing a mobile number and an admin typing an address share
          // this field, and the email keypad hides digits on some phones.
          inputMode={appOnly ? "email" : "text"}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={appOnly ? "admin@yourmess.com" : "admin@yourmess.com or 9876543210"}
          aria-describedby="identifier-hint"
          aria-invalid={state.error ? true : undefined}
          className="bg-background/60 h-12 rounded-xl text-base"
        />
        <p id="identifier-hint" className="text-muted-foreground text-xs">
          {appOnly
            ? "Students and counter staff sign in on the app, not here."
            : "Students sign in with the mobile number the mess has on file."}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            aria-invalid={state.error ? true : undefined}
            className="bg-background/60 h-12 rounded-xl pr-12 text-base"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            // Students type long temporary passwords on a phone keyboard; without
            // this they mistype, get the deliberately vague error, and think the
            // account is broken.
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md transition focus-visible:ring-[3px] focus-visible:outline-none"
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
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

      <SubmitButton />

      <p className="text-muted-foreground text-center text-xs">
        Forgotten your password? Ask the mess admin to reset it.
      </p>
    </form>
  );
}
