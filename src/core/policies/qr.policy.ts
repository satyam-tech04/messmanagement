/**
 * QR attendance token policy (architecture doc §6).
 *
 * Tokens are **stateless HMAC**, not database rows. A 300-student mess
 * refreshing every 15 seconds would generate ~72,000 writes per hour if tokens
 * were persisted; that write amplification buys nothing, because the real
 * anti-replay guarantee is the `UNIQUE (tenant_id, student_id, service_date,
 * meal_slot)` constraint on `attendance`. The short TTL only narrows the window
 * for social sharing — a student screenshotting their code and messaging it to
 * a friend.
 *
 *   payload = base64url({ v, t, s, m, d, iat, n })
 *   token   = payload + "." + HMAC_SHA256(payload, tenantSecret)
 *
 * This module is pure: it takes a clock reading and tenant settings as inputs
 * and returns a decision. It performs the checks that need no database
 * (signature, TTL, tenant match, slot served, meal window). The account checks
 * that do need one — subscription active, student not blocked, no approved
 * mess-cut — belong to the VerifyAttendance use case, which runs them after
 * these pass.
 */

import type { MealSlot } from "../domain/enums";
import type { TenantSettings } from "../domain/tenant-context";
import { findMealSlotConfig } from "../domain/tenant-context";
import type { TokenSigner } from "../ports/token-signer";
import { domainError, type DomainError } from "../errors";
import { err, ok, type Result } from "../result";
import {
  addDays,
  isWithinWindow,
  mealWindowOn,
  serviceDateOf,
  toServiceDate,
  type ServiceDate,
} from "../time";

/** Bumped if the payload shape ever changes, so old tokens fail closed. */
export const QR_TOKEN_VERSION = 1;

export interface QrTokenPayload {
  /** Schema version. */
  readonly v: number;
  /** Tenant id. */
  readonly t: string;
  /** Student id. */
  readonly s: string;
  /** Meal slot this token is valid for. */
  readonly m: MealSlot;
  /** Service date, tenant-local (§2.9). */
  readonly d: ServiceDate;
  /** Issued-at, epoch milliseconds. */
  readonly iat: number;
  /** Random nonce — makes each token distinct even within the same second. */
  readonly n: string;
}

export interface IssueTokenInput {
  readonly tenantId: string;
  readonly studentId: string;
  readonly mealSlot: MealSlot;
  readonly settings: TenantSettings;
  readonly now: Date;
  readonly timezone: string;
  readonly secret: string;
  readonly nonce: string;
  /** Injected per call — core never imports crypto (§2.2). */
  readonly signer: TokenSigner;
}

export interface IssuedToken {
  readonly token: string;
  readonly expiresAt: Date;
  /** How often the student's screen should redraw, in seconds. */
  readonly refreshSeconds: number;
  readonly serviceDate: ServiceDate;
}

// ---------------------------------------------------------------------------
// base64url — no padding, URL-safe alphabet
//
// Hand-rolled rather than using Buffer so core stays environment-agnostic
// (§2.2): the same code runs in a Node route handler and in a test.
// ---------------------------------------------------------------------------

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

export function base64UrlDecode(input: string): string {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of input) {
    const value = B64_ALPHABET.indexOf(char);
    if (value === -1) throw new Error("Invalid base64url character");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------

/**
 * Mints a signed token.
 *
 * Note what is NOT checked here: whether the student is blocked or their
 * subscription is active. Those are account checks the caller performs *before*
 * calling this — §6.1 requires issuance to check account status and
 * verification to re-check it, because a student who pays at 11pm must be able
 * to eat lunch tomorrow without waiting for a nightly job (§7.4).
 */
export function issueToken(input: IssueTokenInput): Result<IssuedToken, DomainError> {
  const slotConfig = findMealSlotConfig(input.settings, input.mealSlot);
  if (!slotConfig) {
    return err(
      domainError("SLOT_NOT_SERVED", `This mess does not serve ${input.mealSlot}.`, {
        slot: input.mealSlot,
      }),
    );
  }

  const serviceDate = serviceDateOf(input.timezone, input.now);
  const payload: QrTokenPayload = {
    v: QR_TOKEN_VERSION,
    t: input.tenantId,
    s: input.studentId,
    m: input.mealSlot,
    d: serviceDate,
    iat: input.now.getTime(),
    n: input.nonce,
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = input.signer.sign(encoded, input.secret);

  return ok({
    token: `${encoded}.${signature}`,
    expiresAt: new Date(input.now.getTime() + input.settings.qrTokenTtlSeconds * 1000),
    refreshSeconds: input.settings.qrRefreshSeconds,
    serviceDate,
  });
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface VerifyTokenInput {
  readonly token: string;
  /** The tenant the *scanner* belongs to, from its session — never from the token. */
  readonly expectedTenantId: string;
  readonly settings: TenantSettings;
  readonly timezone: string;
  readonly secret: string;
  readonly now: Date;
  readonly signer: TokenSigner;
}

export interface VerifiedToken {
  readonly studentId: string;
  readonly mealSlot: MealSlot;
  readonly serviceDate: ServiceDate;
  readonly issuedAt: Date;
}

/**
 * Validates the stateless parts of a scanned token, in the order given by §6.3.
 *
 * Order matters for more than tidiness: the signature is checked **first** so
 * that no attacker-controlled field is ever acted upon before it is proven
 * authentic. Parsing an unverified payload and trusting its `t` or `d` would
 * defeat the whole scheme.
 *
 * Fails closed throughout (§2.7) — anything unparseable is `INVALID_TOKEN`.
 */
export function verifyToken(input: VerifyTokenInput): Result<VerifiedToken, DomainError> {
  // --- 1. Structure ---
  const separator = input.token.lastIndexOf(".");
  if (separator <= 0 || separator === input.token.length - 1) {
    return err(domainError("INVALID_TOKEN", "Malformed token."));
  }
  const encoded = input.token.slice(0, separator);
  const signature = input.token.slice(separator + 1);

  // --- 2. Signature, before trusting any field ---
  if (!input.signer.verify(encoded, signature, input.secret)) {
    return err(domainError("INVALID_TOKEN", "Signature verification failed."));
  }

  // --- 3. Payload shape ---
  let payload: QrTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded)) as QrTokenPayload;
  } catch {
    return err(domainError("INVALID_TOKEN", "Token payload is not readable."));
  }

  if (
    payload.v !== QR_TOKEN_VERSION ||
    typeof payload.t !== "string" ||
    typeof payload.s !== "string" ||
    typeof payload.m !== "string" ||
    typeof payload.d !== "string" ||
    typeof payload.iat !== "number" ||
    !Number.isFinite(payload.iat)
  ) {
    return err(domainError("INVALID_TOKEN", "Token payload is malformed or out of date."));
  }

  // --- 4. Tenant match ---
  // A token signed by another tenant cannot reach here (different secret), but
  // check anyway: defence in depth costs one comparison, and a shared or
  // mis-provisioned secret must not become a cross-tenant meal.
  if (payload.t !== input.expectedTenantId) {
    return err(domainError("TENANT_MISMATCH", "Token was issued for a different mess."));
  }

  // --- 5. TTL ---
  const ageMs = input.now.getTime() - payload.iat;
  const ttlMs = input.settings.qrTokenTtlSeconds * 1000;
  if (ageMs > ttlMs) {
    return err(
      domainError("EXPIRED_TOKEN", "This code has expired. Ask the student to refresh.", {
        ageSeconds: Math.floor(ageMs / 1000),
        ttlSeconds: input.settings.qrTokenTtlSeconds,
      }),
    );
  }
  // A token from the future means a tampered payload or badly skewed clock.
  // A small negative tolerance absorbs ordinary clock drift between the phone
  // and the server without opening a window for a forged future timestamp.
  if (ageMs < -CLOCK_SKEW_TOLERANCE_MS) {
    return err(domainError("INVALID_TOKEN", "Token timestamp is implausible."));
  }

  // --- 6. Slot is actually served here ---
  const slotConfig = findMealSlotConfig(input.settings, payload.m);
  if (!slotConfig) {
    return err(
      domainError("SLOT_NOT_SERVED", `This mess does not serve ${payload.m}.`, {
        slot: payload.m,
      }),
    );
  }

  // --- 7. Meal window, in the tenant's timezone ---
  let serviceDate: ServiceDate;
  try {
    serviceDate = toServiceDate(payload.d);
  } catch {
    return err(domainError("INVALID_TOKEN", "Token carries an invalid service date."));
  }

  const window = mealWindowOn(input.timezone, serviceDate, slotConfig);
  if (!isWithinWindow(input.now, window)) {
    return err(
      domainError("OUTSIDE_MEAL_HOURS", `${payload.m} is not being served right now.`, {
        slot: payload.m,
        opensAt: window.opensAt.toISOString(),
        closesAt: window.closesAt.toISOString(),
      }),
    );
  }

  return ok({
    studentId: payload.s,
    mealSlot: payload.m,
    serviceDate,
    issuedAt: new Date(payload.iat),
  });
}

/** Tolerated clock skew between a student's phone and the server. */
export const CLOCK_SKEW_TOLERANCE_MS = 5_000;

/**
 * The slot currently being served, if any. Used by the student QR screen to
 * decide which token to request without making the student choose.
 */
export function currentMealSlot(
  settings: TenantSettings,
  timezone: string,
  now: Date,
): MealSlot | undefined {
  const today = serviceDateOf(timezone, now);
  for (const config of settings.mealSlots) {
    if (isWithinWindow(now, mealWindowOn(timezone, today, config))) return config.slot;
    // A window that crosses midnight belongs to the previous service date, so
    // a 00:15 scan still resolves to the previous evening's dinner.
    if (config.end <= config.start) {
      const yesterday = mealWindowOn(timezone, addDays(today, -1), config);
      if (isWithinWindow(now, yesterday)) return config.slot;
    }
  }
  return undefined;
}
