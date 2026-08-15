"use client";

/**
 * Reading a QR code off the camera, as fast as the device can manage.
 *
 * Three things made the original slow, and all three are fixed here:
 *
 *   1. **`BrowserMultiFormatReader` tried every barcode format on every frame** —
 *      QR, Data Matrix, Aztec, PDF417, and all the 1D symbologies. The counter
 *      only ever sees a QR code, so the rest was pure waste on a tablet CPU.
 *   2. **zxing waits 500 ms between decode attempts by default**, so it looked
 *      at the video twice a second. That alone is up to half a second of doing
 *      nothing while a student holds their phone up.
 *   3. **The native `BarcodeDetector` was not used.** On Chrome/Android — which
 *      is what a counter tablet runs — it is hardware-accelerated and decodes
 *      an order of magnitude faster than the JavaScript path.
 *
 * The native detector is tried first and zxing remains the fallback, so nothing
 * regresses on a browser without it (Safari, older Android WebViews). No new
 * dependency either way.
 */
import { BrowserQRCodeReader } from "@zxing/browser";
import { probeDetector } from "@/lib/detector-probe";

/** Stops the loop and releases the camera. */
export interface ReaderControls {
  stop: () => void;
}

export type Backend = "native" | "zxing";

/**
 * Poll interval for the JS fallback.
 *
 * 60 ms rather than zxing's 500 ms default: fast enough that the decode feels
 * instant, slow enough to leave the main thread room to paint. Decoding is
 * synchronous, so a zero delay would jank the viewfinder on a cheap tablet and
 * make it *look* slower while doing more work.
 */
const ZXING_ATTEMPT_MS = 60;

/**
 * Camera constraints.
 *
 * `continuous` focus is the important one: a phone screen held at arm's length
 * needs a refocus on every new student, and a fixed-focus stream simply returns
 * blur until the student moves. It is behind a cast because it is not in the
 * TypeScript DOM types yet, and browsers ignore unknown constraints rather than
 * failing — so this degrades quietly where unsupported.
 */
export function cameraConstraints(): MediaStreamConstraints {
  return {
    video: {
      facingMode: "environment",
      // High enough to resolve a QR on a phone screen, low enough that each
      // frame is cheap to decode. 1080p costs more per frame than it wins.
      width: { ideal: 1280 },
      height: { ideal: 720 },
      // A faster stream means less waiting for a readable frame.
      frameRate: { ideal: 30 },
      focusMode: "continuous",
    } as MediaTrackConstraints,
  };
}

interface DetectedBarcode {
  readonly rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

/** The native detector, if this browser has one that can read QR codes. */
async function nativeDetector(): Promise<BarcodeDetectorLike | null> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const supported = await (
      Ctor as unknown as { getSupportedFormats?: () => Promise<string[]> }
    ).getSupportedFormats?.();
    // Chrome exposes the constructor on some platforms where the QR format is
    // not actually available. Constructing it there throws on first detect,
    // mid-service, so the capability is checked up front instead.
    if (supported && !supported.includes("qr_code")) return null;
    return new Ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

/**
 * Starts decoding into `onToken`, resolving once the camera is live.
 *
 * `onToken` fires on **every** successful decode — many times a second for a
 * code held in front of the lens. Deduping is the caller's job; see
 * `src/lib/scan-gate.ts`.
 */
export async function startQrReader(
  video: HTMLVideoElement,
  onToken: (token: string) => void,
): Promise<{ controls: ReaderControls; backend: Backend }> {
  const detector = await nativeDetector();

  if (detector) {
    const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
    video.srcObject = stream;
    await video.play();
    await firstFrame(video);

    // Feature detection is NOT enough — see detector-probe.ts. A browser can
    // report qr_code support and then never resolve `detect()`, which would
    // leave a live viewfinder decoding nothing with no error to explain it.
    // One real decode decides it; a failure falls through to zxing below.
    const works = await probeDetector(() => detector.detect(video));
    if (!works) {
      // Release the camera before zxing opens its own — some Android devices
      // refuse a second stream while the first is held.
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      return startZxing(video, onToken);
    }

    let stopped = false;
    let frame = 0;

    // Driven by rAF rather than a timer, so it decodes in step with the frames
    // the camera actually produces and pauses when the tab is hidden — which
    // matters on a tablet left running all day.
    const loop = async () => {
      if (stopped) return;
      try {
        if (video.readyState >= 2) {
          const codes = await detector.detect(video);
          const value = codes[0]?.rawValue;
          if (value && !stopped) onToken(value);
        }
      } catch {
        // A single dropped frame is not worth surfacing; the next one is 16 ms
        // away. Only a camera failure ends the loop, via `stop`.
      }
      // Re-checked after the await: `stop()` may have run while `detect` was in
      // flight, and scheduling here would leave one frame running past teardown
      // holding a reference to a stopped stream.
      if (!stopped) frame = requestAnimationFrame(() => void loop());
    };
    frame = requestAnimationFrame(() => void loop());

    return {
      backend: "native",
      controls: {
        stop: () => {
          stopped = true;
          cancelAnimationFrame(frame);
          stream.getTracks().forEach((t) => t.stop());
        },
      },
    };
  }

  return startZxing(video, onToken);
}

/** Resolves once the video has a frame worth decoding, or gives up trying. */
function firstFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("loadeddata", done);
      resolve();
    };
    video.addEventListener("loadeddata", done);
    // Never block startup on an event that may not come — probing a blank
    // frame just sends this device down the fallback path, which is safe.
    setTimeout(done, 1000);
  });
}

/**
 * The JavaScript fallback: zxing, QR-only and polled far more often.
 *
 * `BrowserQRCodeReader`, not `BrowserMultiFormatReader` — the counter only ever
 * sees QR codes, and decoding Aztec, PDF417 and every 1D symbology on each
 * frame was pure waste on a tablet CPU.
 */
async function startZxing(
  video: HTMLVideoElement,
  onToken: (token: string) => void,
): Promise<{ controls: ReaderControls; backend: Backend }> {
  const reader = new BrowserQRCodeReader(undefined, {
    delayBetweenScanAttempts: ZXING_ATTEMPT_MS,
    // Zero, not 500: the caller's dedupe decides what counts as a repeat, and
    // it can tell one student's code from the next. A blanket delay here cannot.
    delayBetweenScanSuccess: 0,
  });

  const controls = await reader.decodeFromConstraints(cameraConstraints(), video, (decoded) => {
    if (decoded) onToken(decoded.getText());
  });

  return { backend: "zxing", controls };
}
