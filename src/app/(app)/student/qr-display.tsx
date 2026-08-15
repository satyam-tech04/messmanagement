"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, ShieldOff, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
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
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, string | number | boolean | null>> | null;
  };
}

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: TokenResponse; readonly dataUrl: string }
  | { readonly kind: "denied"; readonly code: string; readonly message: string }
  | {
      readonly kind: "served";
      readonly mealSlot: string;
      readonly servedAt: string | null;
    }
  | { readonly kind: "offline" };

function slotLabel(slot: string): string {
  return slot.charAt(0) + slot.slice(1).toLowerCase();
}

/**
 * Meal times are the mess's, not the phone's.
 *
 * Without an explicit zone this renders in whatever the device is set to, so a
 * student whose phone is on another timezone would be told the counter opens at
 * a time it does not.
 */
function timeOnly(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
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
export function QrDisplay({ timeZone }: { timeZone: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Fetches and renders a token; returns the seconds until the next refresh. */
  const fetchToken = useCallback(async (): Promise<number | null> => {
    try {
      const response = await fetch("/api/qr/token", { cache: "no-store" });

      if (!response.ok) {
        const body = (await response.json()) as DenialResponse;

        // Being fed is not a failure. Render it as a receipt so the student can
        // put their phone away, rather than a red panel that reads as a fault.
        if (body.error?.code === "ALREADY_SERVED") {
          const slot = body.error.details?.slot;
          const at = body.error.details?.servedAt;
          setState({
            kind: "served",
            mealSlot: typeof slot === "string" ? slot : "This meal",
            servedAt: typeof at === "string" ? at : null,
          });
          setSecondsLeft(null);
          // Re-poll gently: once the next meal's window comes round, a fresh
          // code should appear without the student reloading.
          return 60;
        }

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

      // Error correction level M, not H.
      //
      // ECC exists for *physical* damage — creases, dirt, print wear. This code
      // lives for a few seconds on a backlit screen, where none of that
      // applies. What H bought instead was density: measured on a real token it
      // produced an 81x81 grid where M produces 61x61. At the 280 px the code
      // is displayed, that is 3.4 px per module against 4.1 — a quarter more
      // module for the camera to resolve, which is what decides whether it
      // locks on at arm's length or the student has to lean in.
      //
      // `margin: 4`, not 1. The QR specification mandates a four-module quiet
      // zone and decoders rely on it to find the symbol's edges; a margin of 1
      // is out of spec, and a scanner that cannot locate the finder pattern
      // does not decode slowly, it does not decode at all.
      //
      // 640 rather than 512 so a high-DPI phone renders the 280 CSS px element
      // without upscaling a smaller bitmap and softening every module edge.
      const dataUrl = await QRCode.toDataURL(data.token, {
        errorCorrectionLevel: "M",
        margin: 4,
        width: 640,
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
      // Nobody is looking, so nothing needs minting. A student who opens their
      // code and pockets the phone while queuing was, until this check,
      // fetching a new token every fifteen seconds for the whole meal — and
      // each one costs seven database round trips including a write. Across a
      // few hundred students that was the largest source of load in the system,
      // all of it for codes nobody would ever see.
      //
      // Stopping is safe because `onWake` below mints a fresh one the instant
      // the screen comes back, which is also *more* correct than what the timer
      // did: a code minted while hidden would usually have expired by the time
      // it was looked at.
      if (document.visibilityState === "hidden") {
        timerRef.current = null;
        return;
      }

      const next = await fetchToken();
      if (cancelled) return;
      timerRef.current = setTimeout(() => void cycle(), (next ?? 15) * 1000);
    }

    void cycle();

    // A phone asleep in a pocket wakes with an expired code on screen; refresh
    // the moment it comes back rather than showing something already dead. This
    // is also what restarts the loop after `cycle` parked it.
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

  // Countdown ticker, independent of the fetch loop. Purely local — it never
  // touches the network — but it is paused with the screen anyway so a
  // backgrounded tab does no work at all.
  useEffect(() => {
    const tick = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      setSecondsLeft((s) => (s === null ? null : Math.max(0, s - 1)));
    }, 1000);
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

  if (state.kind === "served") {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-4 rounded-2xl border border-emerald-500/40 bg-emerald-50 px-6 py-12 text-center dark:bg-emerald-950/30"
      >
        <CheckCircle2
          className="size-12 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <div className="space-y-1.5">
          <h2 className="text-xl font-semibold text-emerald-900 dark:text-emerald-200">
            {slotLabel(state.mealSlot)} served!
          </h2>
          <p className="text-sm text-emerald-800 dark:text-emerald-300">
            {state.servedAt
              ? `Recorded at ${timeOnly(state.servedAt, timeZone)}. Enjoy your meal.`
              : "Recorded. Enjoy your meal."}
          </p>
        </div>
        <p className="max-w-xs text-xs text-emerald-800/80 dark:text-emerald-300/80">
          Your code for the next meal will appear here automatically.
        </p>
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
            <span className="tabular-nums">{timeOnly(data.closesAt, timeZone)}</span>
          </>
        ) : (
          <>
            Next: <strong>{slotLabel(data.mealSlot)}</strong> at{" "}
            <span className="tabular-nums">{timeOnly(data.opensAt, timeZone)}</span>
            {/* Explicit, because "your code is ready" read as "this will scan
                now" and students were queueing to be refused. */}
            <span className="text-muted-foreground mt-0.5 block text-xs">
              This code will not scan until{" "}
              <span className="tabular-nums">{timeOnly(data.opensAt, timeZone)}</span>.
            </span>
          </>
        )}
      </div>

      {/* White background always, in both themes: a dark-mode inverted QR is
          unreadable by most scanner apps. */}
      <div
        className={cn(
          "relative rounded-2xl border bg-white p-4 shadow-sm transition-opacity",
          data.isOpenNow ? "" : "opacity-60",
        )}
      >
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
