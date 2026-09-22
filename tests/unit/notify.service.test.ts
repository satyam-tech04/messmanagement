/**
 * Sending a notification to a mess full of students.
 *
 * The policy decides who wants one; this use case owns the fan-out, and the
 * fan-out is where push goes wrong in ways nobody notices until 300 phones
 * buzz twice at once. So: a retry sends nothing, a mess with no Firebase
 * credentials publishes announcements exactly as before, and a token FCM has
 * disowned is thrown away rather than retried forever.
 */
import { describe, expect, it } from "vitest";
import { notifyStudents } from "@/core/services/notify";
import { NotificationKind } from "@/core/policies/notification.policy";
import type {
  DeviceTokenRepository,
  NotificationDeliveryRepository,
  NotificationRecipient,
  PushSender,
} from "@/core/ports/repositories";
import { isOk, unwrap } from "@/core/result";

const TENANT = "11111111-1111-1111-1111-111111111111";

function recipient(overrides: Partial<NotificationRecipient> = {}): NotificationRecipient {
  return {
    profileId: "p1",
    studentStatus: "ACTIVE",
    optOuts: [],
    tokens: ["tok-1"],
    ...overrides,
  };
}

function deps(options: {
  recipients?: NotificationRecipient[];
  enabled?: boolean;
  claimed?: boolean;
  deadTokens?: string[];
}) {
  const sends: Array<{ tokens: readonly string[]; title: string; body: string }> = [];
  const pruned: string[] = [];
  const recorded: Array<{ sent: number; failed: number }> = [];
  let claimed = options.claimed ?? true;

  const devices: DeviceTokenRepository = {
    register: async () => {},
    forget: async () => {},
    forgetAllFor: async () => {},
    prune: async (tokens) => {
      pruned.push(...tokens);
    },
    studentsOf: async () => options.recipients ?? [recipient()],
    byProfileIds: async () => options.recipients ?? [recipient()],
    optOutsFor: async () => [],
    setOptOuts: async () => {},
  };

  const deliveries: NotificationDeliveryRepository = {
    claim: async () => {
      // The real one is a unique index: the first caller wins, the rest lose.
      if (!claimed) return false;
      claimed = false;
      return true;
    },
    record: async (_t, _k, _key, counts) => {
      recorded.push(counts);
    },
  };

  const push: PushSender = {
    enabled: options.enabled ?? true,
    send: async (tokens, message) => {
      sends.push({ tokens, title: message.title, body: message.body });
      const dead = (options.deadTokens ?? []).filter((t) => tokens.includes(t));
      return { sent: tokens.length - dead.length, failed: dead.length, deadTokens: dead };
    },
  };

  return { devices, deliveries, push, sends, pruned, recorded };
}

const input = {
  kind: NotificationKind.ANNOUNCEMENT,
  tenantName: "Campus Crave",
  title: "Sunday special",
  body: "Biryani at lunch.",
  dedupeKey: "ANNOUNCEMENT:ann-1",
  audience: "ALL_STUDENTS" as const,
};

describe("sending to a mess", () => {
  it("sends one message to every student's devices", async () => {
    const d = deps({
      recipients: [
        recipient({ profileId: "p1", tokens: ["tok-1", "tok-2"] }),
        recipient({ profileId: "p2", tokens: ["tok-3"] }),
      ],
    });

    const result = await notifyStudents(TENANT, input, d);

    expect(isOk(result)).toBe(true);
    expect(unwrap(result).sent).toBe(3);
    expect(d.sends).toHaveLength(1);
    expect(d.sends[0]!.tokens).toEqual(["tok-1", "tok-2", "tok-3"]);
    expect(d.sends[0]!.title).toBe("Campus Crave · Sunday special");
  });

  it("leaves out anyone who muted this kind, and anyone who has left", async () => {
    const d = deps({
      recipients: [
        recipient({ profileId: "p1", tokens: ["keep"] }),
        recipient({ profileId: "p2", tokens: ["muted"], optOuts: ["ANNOUNCEMENT"] }),
        recipient({ profileId: "p3", tokens: ["gone"], studentStatus: "INACTIVE" }),
      ],
    });

    await notifyStudents(TENANT, input, d);

    expect(d.sends[0]!.tokens).toEqual(["keep"]);
  });

  it("does nothing at all when nobody is left to tell", async () => {
    const d = deps({ recipients: [recipient({ tokens: [] })] });

    const result = await notifyStudents(TENANT, input, d);

    expect(isOk(result)).toBe(true);
    expect(unwrap(result).sent).toBe(0);
    expect(d.sends).toHaveLength(0);
  });
});

describe("when push is not configured", () => {
  it("succeeds and sends nothing", async () => {
    // A mess with no Firebase project must still be able to publish an
    // announcement. Push is a deployment concern, not a feature of the mess.
    const d = deps({ enabled: false });

    const result = await notifyStudents(TENANT, input, d);

    expect(isOk(result)).toBe(true);
    expect(unwrap(result).skipped).toBe("PUSH_DISABLED");
    expect(d.sends).toHaveLength(0);
  });

  it("does not consume the dedupe key, so the event can still be sent later", async () => {
    // Claiming here would mark an announcement as delivered that nobody
    // received — and the day credentials are added, it would stay silent.
    const d = deps({ enabled: false });

    await notifyStudents(TENANT, input, d);

    expect(d.recorded).toHaveLength(0);
  });
});

describe("sending twice", () => {
  it("is refused by the dedupe key, without touching anyone's phone", async () => {
    const d = deps({});

    const first = await notifyStudents(TENANT, input, d);
    const second = await notifyStudents(TENANT, input, d);

    expect(unwrap(first).sent).toBe(1);
    expect(unwrap(second).skipped).toBe("ALREADY_SENT");
    expect(d.sends).toHaveLength(1);
  });
});

describe("tokens that no longer work", () => {
  it("throws away the ones FCM has disowned", async () => {
    // An uninstalled app leaves a token behind forever. Keeping it means
    // paying for a failed send on every announcement, for years.
    const d = deps({
      recipients: [recipient({ tokens: ["live", "dead"] })],
      deadTokens: ["dead"],
    });

    const result = await notifyStudents(TENANT, input, d);

    expect(d.pruned).toEqual(["dead"]);
    expect(unwrap(result).sent).toBe(1);
    expect(d.recorded[0]).toEqual({ sent: 1, failed: 1 });
  });
});

describe("telling one student", () => {
  it("asks only for the students named", async () => {
    const d = deps({ recipients: [recipient({ profileId: "p9", tokens: ["only"] })] });

    const result = await notifyStudents(
      TENANT,
      {
        ...input,
        kind: NotificationKind.ABSENCE_DECISION,
        audience: ["p9"],
        dedupeKey: "ABSENCE_DECISION:cut-1",
      },
      d,
    );

    expect(unwrap(result).sent).toBe(1);
    expect(d.sends[0]!.tokens).toEqual(["only"]);
  });

  it("does nothing when the audience is empty", async () => {
    const d = deps({});

    const result = await notifyStudents(TENANT, { ...input, audience: [] }, d);

    expect(unwrap(result).sent).toBe(0);
    expect(d.sends).toHaveLength(0);
  });
});

describe("a transport that breaks", () => {
  it("reports the failure rather than throwing into the caller", async () => {
    // Publishing an announcement must not fail because Firebase is down. The
    // announcement is the product; the notification is a courtesy.
    const d = deps({});
    const broken = {
      ...d,
      push: {
        enabled: true,
        send: async () => {
          throw new Error("FCM unavailable");
        },
      } satisfies PushSender,
    };

    const result = await notifyStudents(TENANT, input, broken);

    expect(isOk(result)).toBe(true);
    expect(unwrap(result).skipped).toBe("SEND_FAILED");
  });
});
