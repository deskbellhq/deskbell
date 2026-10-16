import { describe, expect, it } from "vitest";

import { signupDecision } from "./hooks";

const NOW = new Date("2026-08-25T12:00:00Z");
const FUTURE = new Date("2026-08-26T12:00:00Z");
const PAST = new Date("2026-08-24T12:00:00Z");

describe("signupDecision", () => {
  it("allows the first user unconditionally — that signup bootstraps the instance", () => {
    expect(signupDecision({ userCount: 0, invitation: null, now: NOW })).toBe("first-user");
  });

  it("closes signup once any user exists and no invitation matches", () => {
    expect(signupDecision({ userCount: 1, invitation: null, now: NOW })).toBe("closed");
  });

  it("admits a pending, unexpired invitation", () => {
    expect(
      signupDecision({
        userCount: 3,
        invitation: { status: "pending", expiresAt: FUTURE },
        now: NOW,
      }),
    ).toBe("invited");
  });

  it("admits a pending invitation with no expiry", () => {
    expect(
      signupDecision({
        userCount: 1,
        invitation: { status: "pending", expiresAt: null },
        now: NOW,
      }),
    ).toBe("invited");
  });

  it("rejects an expired invitation, including exactly at the boundary", () => {
    expect(
      signupDecision({
        userCount: 1,
        invitation: { status: "pending", expiresAt: PAST },
        now: NOW,
      }),
    ).toBe("closed");
    expect(
      signupDecision({ userCount: 1, invitation: { status: "pending", expiresAt: NOW }, now: NOW }),
    ).toBe("closed");
  });

  it("rejects consumed or revoked invitations — a used link must not reopen signup", () => {
    for (const status of ["accepted", "canceled", "rejected"]) {
      expect(
        signupDecision({ userCount: 1, invitation: { status, expiresAt: FUTURE }, now: NOW }),
      ).toBe("closed");
    }
  });
});
