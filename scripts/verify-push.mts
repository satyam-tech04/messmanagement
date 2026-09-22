#!/usr/bin/env tsx
/**
 * Proves this deployment can actually send a notification (D-34).
 *
 * The three ways push fails silently, checked in order:
 *
 *   1. **No credential**, which is the expected state until Firebase exists.
 *   2. **A credential that cannot authenticate** — usually a private key whose
 *      newlines were mangled by an environment-variable UI, which looks
 *      completely fine in the dashboard and signs nothing.
 *   3. **A project that rejects our messages**, checked by sending to a
 *      deliberately invalid token: FCM answers UNREGISTERED or INVALID_ARGUMENT
 *      if we are authenticated and talking to a real project, and 401/403 if we
 *      are not. Nobody's phone is involved.
 *
 * Prints nothing sensitive — not the key, not the token, not the project's
 * private details.
 *
 * Usage: npm run verify:push
 */
import { loadEnv } from "./load-env.mjs";

loadEnv();

const pass = (m: string) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const fail = (m: string) => console.error(`  \x1b[31m✖\x1b[0m ${m}`);

const { createPushSender, isPushConfigured } = await import("../src/infra/push/fcm-sender");

console.log("\nPush notifications");

if (!isPushConfigured()) {
  console.log(
    "  \x1b[33m—\x1b[0m FIREBASE_SERVICE_ACCOUNT_JSON is not set, so push is off.\n" +
      "    The app and console work normally. See docs/PUSH-SETUP.md to switch it on.",
  );
  process.exit(0);
}

pass("credential found and parsed");

const sender = createPushSender();

// A syntactically plausible token that belongs to nobody. Authentication has to
// succeed for FCM to get far enough to reject it.
const result = await sender.send(["fake-token-for-verification-only"], {
  kind: "ANNOUNCEMENT",
  title: "verification",
  body: "verification",
  route: "/",
});

if (result.deadTokens.length === 1) {
  pass("authenticated, and the project accepted the request (the fake token was rejected)");
  console.log("\n\x1b[32mPush is configured correctly.\x1b[0m\n");
  process.exit(0);
}

fail(
  "could not authenticate against FCM. The usual cause is a private key whose " +
    "newlines were mangled — re-paste it as base64 (see docs/PUSH-SETUP.md §6).",
);
process.exit(1);
