/**
 * Push, for application code (D-34).
 *
 * The transport lives in `./fcm-sender` so the verification script can run it
 * outside Next. This file is the `server-only` boundary: the service account it
 * reads can notify every student on the platform, and an accidental import into
 * a client component would put it in a bundle shipped to phones.
 */
import "server-only";

export { createPushSender, isPushConfigured } from "./fcm-sender";
