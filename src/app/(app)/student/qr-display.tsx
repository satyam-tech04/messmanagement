"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { AlertCircle, Loader2, RefreshCw, ShieldOff, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface TokenResponse {
  readonly token: string;
  readonly mealSlot: string;
  readonly serviceDate: string;
  readonly expiresAt: string;
  readonly refreshSeconds: number;
  readonly isOpenNow: boolean;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly studentName: string;
  readonly rollNumber: string;
}

interface DenialResponse {
  readonly error: { readonly code: string; readonly message: string };
}

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: TokenResponse; readonly dataUrl: string }
  | { readonly kind: "denied"; readonly code: string; readonly message: string }
  | { readonly kind: "offline" };

function slotLabel(slot: string): string {
  return slot.charAt(0) + slot.slice(1).toLowerCase();
}

function timeOnly(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * The rotating QR code (§6.2).
 *
 * Re-fetches every `refreshSeconds` — a value the server derives from tenant
 * settings and guarantees is strictly below the token's TTL, so the student is
 * never holding an already-dead code between redraws.
 *
 * Rendered as a data URL on a canvas rather than server-side, because the token
 * changes every few seconds and a server round trip per redraw would double the
 * traffic for no benefit.
 */
export function QrDisplay() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Fetches and renders a token; returns the seconds until the next refresh. */
  const fetchToken = useCallback(async (): Promise<number | null> => {
    try {
      const response = await fetch("/api/qr/token", { cache: "no-store" });

      if (!response.ok) {
        const body = (await response.json()) as DenialResponse;
        setState({
          kind: "denied",
          code: body.error?.code ?? "UNKNOWN",
          message: body.error?.message ?? "Your QR code is unavailable.",
        });
        setSecondsLeft(null);
        // A denial is a decision, not a blip. Re-poll slowly so a student who
        // pays at the office sees their code return without a manual reload,
        // but do not hammer the endpoint.
        return 30;
      }

      const data = (await response.json()) as TokenResponse;

      // Highest error correction: the code is read off a lit phone screen at an
      // angle, often with a fingerprint smudge across it.
      const dataUrl = await QRCode.toDataURL(data.token, {
        errorCorrectionLevel: "H",
        margin: 1,
        width: 512,
      });

      setState({ kind: "ready", data, dataUrl });
      setSecondsLeft(data.refreshSeconds);
      return data.refreshSeconds;
    } catch {
      // Distinguished from a denial: a dropped connection is worth retrying
      // soon, because the student is standing in the queue right now.
      setState({ kind: "offline" });
      setSecondsLeft(null);
      return 5;
    }
  }, []);

  /**
   * One effect owns the whole rotation loop.
   *
   * Split across several effects this cascaded: each fetch set state, which
   * re-ran the scheduling effect, which cleared and re-armed the timer. Here the
   * loop re-arms itself from the response's own `refreshSeconds`, so a tenant
   * changing its rotation settings takes effect without a deploy, and a single
   * `cancelled` flag stops everything on unmount.
   */
  useEffect(() => {
    let cancelled = false;

    async function cycle() {
      const next = await fetchToken();
      if (cancelled) return;
      timerRef.current = setTimeout(() => void cycle(), (next ?? 15) * 1000);
    }

    void cycle();

    // A phone asleep in a pocket wakes with an expired code on screen; refresh
    // the moment it comes back rather than showing something already dead.
    function onWake() {
      if (document.visibilityState !== "visible") return;
      if (timerRef.current) clearTimeout(timerRef.current);
      void cycle();
    }

    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [fetchToken]);

  // Countdown ticker, independent of the fetch loop.
  useEffect(() => {
    const tick = setInterval(
      () => setSecondsLeft((s) => (s === null ? null : Math.max(0, s - 1))),
      1000,
    );
    return () => clearInterval(tick);
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="flex flex-col items-center gap-4">
        <Skeleton className="aspect-square w-full max-w-[300px] rounded-2xl" />
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }

  if (state.kind === "offline") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-amber-500/30 bg-amber-50 px-6 py-12 text-center dark:bg-amber-950/30">
        <WifiOff className="size-10 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <div className="space-y-1.5">
          <h2 className="font-semibold text-amber-900 dark:text-amber-200">No connection</h2>
          <p className="mx-auto max-w-xs text-sm text-amber-800 dark:text-amber-300">
            Your code cannot be generated offline. Show your roll number at the counter — staff can
            serve you manually.
          </p>
        </div>
        <Button variant="outline" onClick={() => void fetchToken()}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }

  if (state.kind === "denied") {
    const retryable = state.code === "INFRASTRUCTURE_ERROR" || state.code === "RATE_LIMITED";
    return (
      <div className="border-destructive/30 bg-destructive/5 flex flex-col items-center gap-4 rounded-2xl border px-6 py-12 text-center">
        {state.code === "BLOCKED_UNPAID" ? (
          <ShieldOff className="text-destructive size-10" aria-hidden="true" />
        ) : (
          <AlertCircle className="text-destructive size-10" aria-hidden="true" />
        )}
        <div className="space-y-1.5">
          <h2 className="font-semibold">No QR code right now</h2>
          {/* The server's message is specific — "your plan does not include this
              meal" rather than a generic failure — so the student knows whether
              to visit the mess office or simply wait. */}
          <p className="text-muted-foreground mx-auto max-w-xs text-sm">{state.message}</p>
        </div>
        {retryable ? (
          <Button variant="outline" onClick={() => void fetchToken()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </Button>
        ) : (
          <p className="text-muted-foreground text-xs">
            Speak to the mess office if you think this is wrong.
          </p>
        )}
      </div>
    );
  }

  const { data, dataUrl } = state;

  return (
    <div className="flex flex-col items-center gap-5">
      <div
        className={`w-full rounded-xl border px-4 py-3 text-center text-sm ${
          data.isOpenNow
            ? "border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
            : "bg-muted/50"
        }`}
      >
        {data.isOpenNow ? (
          <>
            <strong>{slotLabel(data.mealSlot)}</strong> is being served — closes{" "}
            <span className="tabular-nums">{timeOnly(data.closesAt)}</span>
          </>
        ) : (
          <>
            Next: <strong>{slotLabel(data.mealSlot)}</strong> at{" "}
            <span className="tabular-nums">{timeOnly(data.opensAt)}</span>
            <span className="text-muted-foreground mt-0.5 block text-xs">
              Your code is ready — show it when the counter opens.
            </span>
          </>
        )}
      </div>

      {/* White background always, in both themes: a dark-mode inverted QR is
          unreadable by most scanner apps. */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dataUrl}
          alt={`QR code for ${data.rollNumber}. Show this at the counter.`}
          className="aspect-square w-full max-w-[280px]"
          width={280}
          height={280}
        />
      </div>

      <div className="space-y-1 text-center">
        <p className="font-mono text-lg font-semibold tracking-wide">{data.rollNumber}</p>
        <p className="text-muted-foreground text-sm">{data.studentName}</p>
      </div>

      <div
        className="text-muted-foreground flex items-center gap-2 text-xs"
        aria-live="polite"
        aria-atomic="true"
      >
        {secondsLeft !== null && secondsLeft <= 1 ? (
          <>
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Refreshing…
          </>
        ) : (
          <>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Refreshes in <span className="tabular-nums">{secondsLeft ?? "—"}</span>s
          </>
        )}
      </div>

      <p className="text-muted-foreground max-w-xs text-center text-xs">
        This code changes every few seconds. A screenshot will not work at the counter.
      </p>
    </div>
  );
}
