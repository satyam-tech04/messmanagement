/**
 * Tests for the native-decoder capability probe.
 *
 * Written because the obvious check is not enough. Probing headless Chrome on
 * macOS found a browser that:
 *
 *   - exposes `BarcodeDetector`
 *   - returns `qr_code` from `getSupportedFormats()`
 *   - constructs a detector without complaint
 *   - and then **never resolves `detect()`**
 *
 * Feature-detection alone would have picked the native path on that device and
 * left the counter decoding nothing, forever, with a live camera and no error.
 * Staff would be holding a working scanner that never beeps, mid-service, with
 * a queue. So capability is established by *doing one decode*, not by asking.
 *
 * The distinction that matters: `detect()` resolving with **zero** results is a
 * success — it means the decoder works and there was simply no code in frame.
 */
import { describe, expect, it } from "vitest";
import { NATIVE_PROBE_MS, probeDetector } from "@/lib/detector-probe";

const never = () => new Promise<unknown[]>(() => {});

describe("probeDetector — a decoder must prove it works", () => {
  it("accepts one that resolves with a result", async () => {
    expect(await probeDetector(async () => [{ rawValue: "x" }], 50)).toBe(true);
  });

  it("accepts one that resolves with nothing — an empty frame is not a failure", async () => {
    // The common case at startup: the camera is live but no student is holding
    // a code up yet. Treating this as unsupported would send every device down
    // the slow path.
    expect(await probeDetector(async () => [], 50)).toBe(true);
  });

  it("rejects one that never resolves — the headless-Chrome case", async () => {
    expect(await probeDetector(never, 30)).toBe(false);
  });

  it("rejects one that throws", async () => {
    expect(
      await probeDetector(async () => {
        throw new Error("Source would taint origin");
      }, 50),
    ).toBe(false);
  });

  it("rejects one that rejects asynchronously", async () => {
    expect(await probeDetector(() => Promise.reject(new Error("no service")), 50)).toBe(false);
  });

  it("does not hang past its timeout", async () => {
    const started = Date.now();
    await probeDetector(never, 40);
    // Generous upper bound — the point is that it returns at all.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("rejects a detector returning something that is not a list", async () => {
    // A malformed shim rather than a real implementation. Fail closed onto
    // zxing rather than trusting whatever this is.
    expect(await probeDetector(async () => undefined as unknown as unknown[], 50)).toBe(false);
  });
});

describe("NATIVE_PROBE_MS", () => {
  it("is short enough not to stall the camera visibly", async () => {
    // This delay is paid once, at startup, on devices where the native path is
    // broken. Longer than a blink and staff watch a dead viewfinder.
    expect(NATIVE_PROBE_MS).toBeLessThanOrEqual(400);
  });

  it("is long enough for a real decoder's first call", async () => {
    // The first `detect()` warms up the platform service and is far slower than
    // steady state. Too tight and a working device is demoted to the JS path.
    expect(NATIVE_PROBE_MS).toBeGreaterThanOrEqual(150);
  });
});
