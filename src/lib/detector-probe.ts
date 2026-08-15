/**
 * Does this browser's native barcode decoder actually work?
 *
 * Feature detection is not enough, and that is not a theoretical worry — it was
 * measured. Headless Chrome on macOS exposes `BarcodeDetector`, reports
 * `qr_code` in `getSupportedFormats()`, constructs a detector happily, and then
 * never resolves `detect()`. A scanner that trusted the feature check on such a
 * device would show a live viewfinder that decodes nothing, forever, with no
 * error to explain it — discovered by staff, mid-service, with a queue.
 *
 * So capability is established by performing one real decode against a real
 * frame and requiring it to come back. Fail closed onto the JavaScript decoder:
 * slower is survivable, dead is not.
 */

/**
 * How long the one probing decode gets.
 *
 * Paid once at startup, and only wasted on devices where the native path is
 * broken. Generous enough for a cold platform service — the first call warms it
 * up and is much slower than steady state — but short enough that staff do not
 * watch a stalled viewfinder.
 */
export const NATIVE_PROBE_MS = 250;

/** Just the shape this needs; the DOM types do not ship `BarcodeDetector` yet. */
export type DetectFn = () => Promise<unknown[]>;

export async function probeDetector(
  detect: DetectFn,
  timeoutMs: number = NATIVE_PROBE_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      detect(),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
      }),
    ]);

    // Resolving with an EMPTY array is a pass: the decoder ran and there was
    // simply no code in frame, which is the normal state at startup. Only a
    // non-list means something other than a real implementation answered.
    return Array.isArray(result);
  } catch {
    // Threw or rejected — a tainted source, a missing platform service, a
    // permissions quirk. Whatever it is, this decoder cannot be relied on.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const TIMED_OUT = Symbol("timed-out");
