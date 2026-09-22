/**
 * Firebase Cloud Messaging transport, over the HTTP v1 API (D-34).
 *
 * Deliberately WITHOUT the `server-only` guard, so `scripts/verify-push.mts`
 * can exercise the real code rather than a copy of it. Application code imports
 * `./fcm`, which is the guarded entry point — nothing here should be reached
 * from a component.
 *
 * No SDK and no new dependency: the whole of FCM v1 is one OAuth token and one
 * POST per device, and `firebase-admin` would pull a large tree of Google
 * client libraries into a Next server bundle to do exactly this.
 *
 * **Absent credentials disable push rather than breaking anything.** A
 * deployment without a Firebase project — which is every deployment until one
 * is created — gets a sender that reports `enabled: false`, and the use case
 * skips silently. Publishing an announcement must never depend on Firebase.
 *
 * The access token is a service-account JWT exchanged for an OAuth token,
 * cached until shortly before it expires. Signing is RS256 with node's own
 * crypto, which is all Google asks for.
 */
import { createSign } from "node:crypto";
import { z } from "zod";
import type { PushMessage } from "@/core/policies/notification.policy";
import type { PushSender, PushSendResult } from "@/core/ports/repositories";

const credentialsSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.email(),
  // Vercel's environment UI turns real newlines into `\n`, which produces a key
  // that looks right and cannot sign anything. Repaired here rather than being
  // a deployment note nobody reads.
  private_key: z
    .string()
    .min(1)
    .transform((key) => key.replace(/\\n/g, "\n")),
});

type Credentials = z.infer<typeof credentialsSchema>;

function readCredentials(): Credentials | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || raw.trim().length === 0) return null;

  try {
    // Accepts the JSON file's contents directly, or base64 of it — one of the
    // two always survives whatever is pasting it into an environment variable.
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = credentialsSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let cached: { token: string; expiresAt: number } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function accessTokenFor(credentials: Credentials): Promise<string> {
  // A minute of slack: a token that expires mid-flight fails the whole fan-out.
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(credentials.private_key));

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });

  if (!response.ok) {
    throw new Error(`FCM token exchange failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

/**
 * The Android notification channel every message is delivered on.
 *
 * Must equal `androidChannelId` in the app's push_logic.dart and the default
 * declared in AndroidManifest.xml. If they drift, background notifications fall
 * into Android's generic "Miscellaneous" channel, which the student cannot
 * silence separately from everything else. `tests/unit/push-channel.test.ts`
 * holds the three together.
 */
export const ANDROID_CHANNEL_ID = "mealadda_default";

/**
 * The FCM v1 request body for one device.
 *
 * Pure, so its shape is tested rather than discovered: FCM rejects the whole
 * message if any `data` value is not a string, and silently delivers into the
 * wrong Android channel if `channel_id` is missing.
 */
export function fcmMessageFor(token: string, message: PushMessage) {
  return {
    message: {
      token,
      notification: { title: message.title, body: message.body },
      // Read by the app to route the tap. Every value must be a string.
      data: { kind: message.kind, route: message.route },
      android: {
        priority: "HIGH",
        notification: { sound: "default", channel_id: ANDROID_CHANNEL_ID },
      },
      apns: {
        payload: { aps: { sound: "default", badge: 1 } },
      },
    },
  };
}

/**
 * Whether FCM is saying this token will never work again.
 *
 * Deliberately narrow, because the cost of a false positive is enormous: the
 * token is deleted, and that student silently stops hearing anything.
 *
 * `UNREGISTERED` and `NOT_FOUND` always mean the token is gone. But
 * `INVALID_ARGUMENT` is ambiguous — FCM returns it for a malformed *token* and
 * for a malformed *message* alike. Treating every one as a dead token means a
 * single payload bug deletes every student's device in one send. So it counts
 * only when FCM's own message says the problem is the registration token.
 */
export function isDeadTokenError(
  error: { status?: string; message?: string } | undefined,
): boolean {
  if (!error?.status) return false;
  if (error.status === "UNREGISTERED" || error.status === "NOT_FOUND") return true;
  if (error.status === "INVALID_ARGUMENT") {
    return /registration token/i.test(error.message ?? "");
  }
  return false;
}

/** How many sends are in flight at once. A mess is hundreds of students. */
const CONCURRENCY = 20;

class FcmPushSender implements PushSender {
  readonly enabled = true;

  constructor(private readonly credentials: Credentials) {}

  async send(tokens: readonly string[], message: PushMessage): Promise<PushSendResult> {
    const accessToken = await accessTokenFor(this.credentials);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${this.credentials.project_id}/messages:send`;

    let sent = 0;
    let failed = 0;
    const deadTokens: string[] = [];

    const queue = [...tokens];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let token = queue.pop(); token; token = queue.pop()) {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(fcmMessageFor(token, message)),
          });

          if (response.ok) {
            sent++;
            continue;
          }

          failed++;
          const error = (await response.json().catch(() => null)) as {
            error?: { status?: string; message?: string };
          } | null;
          if (isDeadTokenError(error?.error)) deadTokens.push(token);
        } catch {
          // Network-level failure: transient by assumption, so the token lives.
          failed++;
        }
      }
    });

    await Promise.all(workers);

    return { sent, failed, deadTokens };
  }
}

/** Reports disabled and sends nothing. The default until Firebase exists. */
class DisabledPushSender implements PushSender {
  readonly enabled = false;

  async send(): Promise<PushSendResult> {
    return { sent: 0, failed: 0, deadTokens: [] };
  }
}

export function createPushSender(): PushSender {
  const credentials = readCredentials();
  return credentials ? new FcmPushSender(credentials) : new DisabledPushSender();
}

/** Whether this deployment can push at all. Shown on the admin settings screen. */
export function isPushConfigured(): boolean {
  return readCredentials() !== null;
}
