import { describe, expect, it } from "vitest";
import {
  newSigningSecret,
  signNotification,
  verifyNotificationSignature,
} from "./notification-signature";

describe("notification signature", () => {
  const secret = "whsec_test";
  const body = '{"type":"feedback.negative","id":"ntf_1"}';
  const ts = 1_700_000_000_000;

  it("signs and verifies a body at a timestamp", async () => {
    const header = await signNotification(secret, ts, body);
    expect(header).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(
      await verifyNotificationSignature({ secret, timestamp: String(ts), body, header, now: ts }),
    ).toBe(true);
  });

  it("rejects a tampered body, a wrong secret and a stale timestamp", async () => {
    const header = await signNotification(secret, ts, body);
    expect(
      await verifyNotificationSignature({
        secret,
        timestamp: ts,
        body: `${body} `,
        header,
        now: ts,
      }),
    ).toBe(false);
    expect(
      await verifyNotificationSignature({ secret: "other", timestamp: ts, body, header, now: ts }),
    ).toBe(false);
    expect(
      await verifyNotificationSignature({
        secret,
        timestamp: ts,
        body,
        header,
        now: ts + 6 * 60 * 1000,
      }),
    ).toBe(false);
    expect(
      await verifyNotificationSignature({ secret, timestamp: "abc", body, header, now: ts }),
    ).toBe(false);
  });

  it("mints distinct, prefixed secrets", () => {
    const a = newSigningSecret();
    const b = newSigningSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});
