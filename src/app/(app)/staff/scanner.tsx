"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Camera, CameraOff, Check, CloudOff, Keyboard, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  refineScanAction,
  scanOutcomeFor,
  scanTitleFor,
  type ScanDetails,
  type ScanOutcome,
} from "@/lib/scan-outcome";
import { enqueueScan, flushScanQueue, queuedScans } from "./scan-queue";
import { ManualEntryDialog } from "./manual-entry";

interface VerifyResponse {
  readonly ok: boolean;
  readonly code: string;
  readonly message?: string;
  readonly rollNumber?: string;
  readonly fullName?: string;
  readonly photoUrl?: string | null;
  readonly mealSlot?: string;
  readonly auditFailed?: boolean;
  readonly details?: ScanDetails;
}

interface Result {
  readonly outcome: ScanOutcome;
  /** Names the meal, e.g. "Breakfast served!". */
  readonly title: string;
  /** Sharpened with the server's detail, e.g. when the counter opens. */
  readonly action: string;
  readonly response: VerifyResponse;
  readonly at: number;
}

/** How long a result stays on screen before the scanner re-arms. */
const RESULT_MS = 2600;
/** Ignore the same token re-read by the camera within this window. */
const DEDUPE_MS = 3000;

const TONE_PANEL: Record<string, string> = {
  success: "bg-emerald-500 text-white",
  warning: "bg-amber-500 text-white",
  danger: "bg-red-600 text-white",
  info: "bg-sky-600 text-white",
  neutral: "bg-slate-600 text-white",
};

/**
 * Short, distinct feedback tones (§6.4).
 *
 * Staff work heads-down over a queue and hear the result before they read it.
 * Synthesised rather than shipped as audio files so there is nothing to load
 * and nothing to fail on a cold cache mid-service.
 */
function beep(tone: string): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    // Rising for success, low and long for a hard denial, short blip otherwise.
    const success = tone === "success";
    const danger = tone === "danger";
    osc.frequency.value = success ? 880 : danger ? 220 : 520;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    if (success) osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (danger ? 0.45 : 0.2));

    osc.start();
    osc.stop(ctx.currentTime + (danger ? 0.45 : 0.2));
    osc.onended = () => void ctx.close();
  } catch {
    // Audio is an enhancement; never let it break a scan.
  }
}

export function Scanner({ deviceId, timeZone }: { deviceId: string; timeZone: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastScanRef = useRef<{ token: string; at: number } | null>(null);
  const busyRef = useRef(false);

  const [cameraState, setCameraState] = useState<"starting" | "on" | "denied" | "unavailable">(
    "starting",
  );
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(0);
  const [servedCount, setServedCount] = useState(0);

  const show = useCallback(
    (response: VerifyResponse) => {
      const code = response.ok ? "SERVED" : response.code;
      const outcome = scanOutcomeFor(code);
      const action = refineScanAction(response.code, response.details ?? null, timeZone);
      // The slot comes back on success; on a duplicate it is in the details.
      const slot =
        response.mealSlot ??
        (typeof response.details?.slot === "string" ? response.details.slot : undefined);
      setResult({ outcome, title: scanTitleFor(code, slot), action, response, at: Date.now() });
      beep(outcome.tone);
      if (response.ok) setServedCount((c) => c + 1);
    },
    [timeZone],
  );

  const submit = useCallback(
    async (body: Record<string, unknown>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const response = await fetch("/api/qr/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as VerifyResponse;
        show(data);
      } catch {
        // Offline. Buffer it — the student is standing there and will be served;
        // replay is safe because the server is idempotent.
        enqueueScan(body);
        setPending(queuedScans().length);
        show({
          ok: false,
          code: "QUEUED_OFFLINE",
          message: "Saved. It will sync when the connection returns.",
        });
      } finally {
        busyRef.current = false;
      }
    },
    [show],
  );

  const onToken = useCallback(
    (token: string) => {
      const last = lastScanRef.current;
      // The camera reads the same code many times a second; without this every
      // successful scan is immediately followed by an ALREADY_SERVED.
      if (last && last.token === token && Date.now() - last.at < DEDUPE_MS) return;
      lastScanRef.current = { token, at: Date.now() };
      void submit({ mode: "QR", token, deviceId });
    },
    [submit, deviceId],
  );

  // --- Camera ---
  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraState("unavailable");
          return;
        }
        const controls = await reader.decodeFromConstraints(
          // Rear camera, and a resolution high enough to read a phone screen at
          // arm's length without pushing decode time up.
          { video: { facingMode: "environment", width: { ideal: 1280 } } },
          videoRef.current!,
          (decoded) => {
            if (decoded && !cancelled) onToken(decoded.getText());
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setCameraState("on");
      } catch {
        if (!cancelled) setCameraState("denied");
      }
    }

    void start();
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  }, [onToken]);

  // --- Result auto-dismiss ---
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), RESULT_MS);
    return () => clearTimeout(timer);
  }, [result]);

  // --- Offline queue ---
  useEffect(() => {
    let cancelled = false;

    async function sync() {
      if (cancelled) return;
      const { synced } = await flushScanQueue();
      if (cancelled) return;
      setPending(queuedScans().length);
      if (synced > 0) setServedCount((c) => c + synced);
    }

    // A named handler, so removeEventListener actually detaches it. Two
    // separate inline arrows never match, and the listener would survive every
    // remount for as long as the tablet stayed open.
    const onOnline = () => void sync();

    // Read the buffer through the same sync path rather than setting state in
    // the effect body: anything left from a previous shift should be flushed,
    // not merely counted.
    void sync();

    window.addEventListener("online", onOnline);
    const interval = setInterval(() => {
      if (navigator.onLine && queuedScans().length > 0) void sync();
    }, 15000);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Served this session</span>
          <span className="font-semibold tabular-nums">{servedCount}</span>
        </div>
        <div className="flex items-center gap-2">
          {pending > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
              <CloudOff className="size-3.5" aria-hidden="true" />
              <span className="tabular-nums">{pending}</span> waiting to sync
            </span>
          ) : null}
          <ManualEntryDialog onSubmit={submit} deviceId={deviceId} />
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border bg-black">
        <video
          ref={videoRef}
          className="aspect-[3/4] w-full object-cover sm:aspect-video"
          playsInline
          muted
        />

        {cameraState === "starting" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
            <Loader2 className="size-8 animate-spin" aria-hidden="true" />
            <p className="text-sm">Starting camera…</p>
          </div>
        ) : null}

        {cameraState === "denied" || cameraState === "unavailable" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center text-white">
            <CameraOff className="size-10" aria-hidden="true" />
            <div className="space-y-1.5">
              <p className="font-semibold">
                {cameraState === "denied" ? "Camera blocked" : "No camera on this device"}
              </p>
              <p className="max-w-xs text-sm text-white/70">
                {cameraState === "denied"
                  ? "Allow camera access in your browser settings, then reload. You can keep serving with manual entry."
                  : "Use manual entry to serve students by roll number."}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                <RefreshCw className="size-4" aria-hidden="true" />
                Reload
              </Button>
            </div>
          </div>
        ) : null}

        {/* Aiming frame — staff need to know where to point. */}
        {cameraState === "on" && !result ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="size-56 rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            <p className="absolute bottom-6 text-sm text-white/80">
              Point at the student&apos;s QR code
            </p>
          </div>
        ) : null}

        {/* The result covers the whole viewfinder: readable at arm's length,
            heads-down, in bad canteen lighting. */}
        {result ? (
          <div
            role="status"
            aria-live="assertive"
            className={cn(
              "absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center",
              TONE_PANEL[result.outcome.tone] ?? TONE_PANEL.danger,
            )}
          >
            {result.response.ok ? (
              <Check className="size-14" strokeWidth={3} aria-hidden="true" />
            ) : (
              <X className="size-14" strokeWidth={3} aria-hidden="true" />
            )}

            <p className="text-2xl font-bold">{result.title}</p>

            {result.response.ok ? (
              <>
                {result.response.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={result.response.photoUrl}
                    alt=""
                    className="size-20 rounded-full border-2 border-white/80 object-cover"
                  />
                ) : null}
                <div>
                  <p className="text-xl font-semibold">{result.response.fullName}</p>
                  <p className="font-mono text-sm opacity-90">{result.response.rollNumber}</p>
                </div>
                {result.response.auditFailed ? (
                  <p className="max-w-xs rounded-lg bg-black/20 px-3 py-2 text-xs">
                    Recorded, but this override was not written to the audit log. Tell the mess
                    admin.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="max-w-xs text-sm opacity-95">
                {result.response.message ?? result.action}
              </p>
            )}

            <p className="max-w-xs text-sm font-medium opacity-90">{result.action}</p>

            <div className="flex gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setResult(null)}>
                Next student
              </Button>
              {result.outcome.allowsManualOverride ? (
                <ManualEntryDialog
                  onSubmit={submit}
                  deviceId={deviceId}
                  trigger={
                    <Button variant="secondary" size="sm">
                      <Keyboard className="size-4" aria-hidden="true" />
                      Manual
                    </Button>
                  }
                  prefillRoll={result.response.rollNumber}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <p className="text-muted-foreground flex items-center justify-center gap-2 text-xs">
        <Camera className="size-3.5" aria-hidden="true" />
        Codes rotate every few seconds — a screenshot will not scan.
      </p>
    </div>
  );
}
