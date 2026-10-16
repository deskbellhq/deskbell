import { describe, expect, it } from "vitest";
import { isPrivateAddress, maskSecret, maskWebhookUrl, validateWebhookUrl } from "./webhook-url";

describe("validateWebhookUrl", () => {
  it("accepts https and normalises the URL", () => {
    const r = validateWebhookUrl("  https://hooks.slack.com/services/T0/B0/xyz  ");
    expect(r).toEqual({ ok: true, url: "https://hooks.slack.com/services/T0/B0/xyz" });
  });

  it("allows http for localhost only", () => {
    expect(validateWebhookUrl("http://localhost:9000/hook").ok).toBe(true);
    expect(validateWebhookUrl("http://127.0.0.1:9000/hook").ok).toBe(true);
    expect(validateWebhookUrl("http://receiver.example/hook").ok).toBe(false);
  });

  it("refuses credentials, private addresses and other schemes", () => {
    expect(validateWebhookUrl("https://user:pw@hooks.example/x").ok).toBe(false);
    expect(validateWebhookUrl("https://10.0.0.5/x").ok).toBe(false);
    expect(validateWebhookUrl("https://169.254.169.254/latest").ok).toBe(false);
    expect(validateWebhookUrl("https://[fd00::1]/x").ok).toBe(false);
    expect(validateWebhookUrl("ftp://hooks.example/x").ok).toBe(false);
    expect(validateWebhookUrl("not a url").ok).toBe(false);
    expect(validateWebhookUrl("").ok).toBe(false);
  });

  it("caps the length", () => {
    expect(validateWebhookUrl(`https://h.example/${"a".repeat(2100)}`).ok).toBe(false);
  });
});

describe("isPrivateAddress", () => {
  it("knows the reserved ranges and nothing else", () => {
    for (const h of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1"]) {
      expect(isPrivateAddress(h), h).toBe(true);
    }
    for (const h of ["8.8.8.8", "172.32.0.1", "hooks.slack.com", "[2001:db8::1]"]) {
      expect(isPrivateAddress(h), h).toBe(false);
    }
  });
});

describe("masking", () => {
  it("keeps the origin of a URL and the prefix of a secret", () => {
    expect(maskWebhookUrl("https://hooks.slack.com/services/T0/B0/xyz")).toBe(
      "https://hooks.slack.com/…",
    );
    expect(maskWebhookUrl("garbage")).toBe("…");
    expect(maskSecret("whsec_abcdefghijklmnop")).toBe("whsec_abcd…");
  });
});
