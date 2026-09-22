/**
 * One Android notification channel, named identically in three places.
 *
 * The server names it in every message, the manifest declares it as FCM's
 * default, and the app creates it on the device. If any one drifts, nothing
 * fails — notifications still arrive, just into Android's generic
 * "Miscellaneous" channel, where a student cannot silence MealAdda without
 * silencing everything else. A failure that silent is only caught by a test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANDROID_CHANNEL_ID, fcmMessageFor, isDeadTokenError } from "@/infra/push/fcm-sender";

const root = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const message = {
  kind: "ANNOUNCEMENT" as const,
  title: "Campus Crave · Sunday special",
  body: "Biryani at lunch.",
  route: "/announcements",
};

describe("the channel is the same everywhere", () => {
  it("matches the default declared in the Android manifest", () => {
    const manifest = read("mobile/android/app/src/main/AndroidManifest.xml");
    const declared = /default_notification_channel_id"\s+android:value="([^"]+)"/.exec(manifest);
    expect(declared?.[1]).toBe(ANDROID_CHANNEL_ID);
  });

  it("matches the channel the app creates on the device", () => {
    const dart = read("mobile/lib/src/state/push_logic.dart");
    expect(dart).toContain(`const androidChannelId = '${ANDROID_CHANNEL_ID}';`);
  });
});

describe("what is sent to FCM", () => {
  const body = fcmMessageFor("device-token", message);

  it("names the channel, so background notifications land in it", () => {
    expect(body.message.android.notification.channel_id).toBe(ANDROID_CHANNEL_ID);
  });

  it("sends only strings in data, which FCM otherwise rejects outright", () => {
    for (const value of Object.values(body.message.data)) {
      expect(typeof value).toBe("string");
    }
  });

  it("carries the route, so a tap opens the screen it is about", () => {
    expect(body.message.data.route).toBe("/announcements");
  });

  it("addresses exactly the device it was built for", () => {
    expect(body.message.token).toBe("device-token");
  });
});

describe("the status-bar icon", () => {
  it("is declared, so Android does not draw a white square", () => {
    // Without it Android renders the colourful launcher icon as a solid white
    // silhouette — the first thing a student sees of every notification.
    const manifest = read("mobile/android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain("default_notification_icon");
    expect(manifest).toContain("@drawable/ic_stat_notification");
    expect(() =>
      read("mobile/android/app/src/main/res/drawable/ic_stat_notification.xml"),
    ).not.toThrow();
  });
});

describe("deciding a token is dead", () => {
  // A false positive deletes the token, and that student silently stops
  // hearing anything. So this is narrow on purpose.
  it("prunes tokens FCM says are gone", () => {
    expect(isDeadTokenError({ status: "UNREGISTERED" })).toBe(true);
    expect(isDeadTokenError({ status: "NOT_FOUND" })).toBe(true);
  });

  it("prunes a token FCM calls an invalid registration token", () => {
    expect(
      isDeadTokenError({
        status: "INVALID_ARGUMENT",
        message: "The registration token is not a valid FCM registration token",
      }),
    ).toBe(true);
  });

  it("does NOT prune when the message itself is malformed", () => {
    // Same status, different cause. Treating this as a dead token would delete
    // every student's device in one send the day a payload bug ships.
    expect(
      isDeadTokenError({
        status: "INVALID_ARGUMENT",
        message: 'Invalid JSON payload received. Unknown name "chanel_id"',
      }),
    ).toBe(false);
  });

  it("never prunes on a transient failure", () => {
    for (const status of ["UNAVAILABLE", "INTERNAL", "QUOTA_EXCEEDED", "UNAUTHENTICATED"]) {
      expect(isDeadTokenError({ status })).toBe(false);
    }
    expect(isDeadTokenError(undefined)).toBe(false);
  });
});
