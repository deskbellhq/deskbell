import { describe, expect, it } from "vitest";

import { readEmailConfig } from "./config";

const env = (init: Record<string, string>) => init as NodeJS.ProcessEnv;

describe("readEmailConfig", () => {
  it("uses SMTP when both the URL and the sender are set", () => {
    const cfg = readEmailConfig(
      env({ SMTP_URL: "smtp://tok:tok@smtp.example.com:587", EMAIL_FROM: "Deskbell <a@b.co>" }),
    );
    expect(cfg.mode).toBe("smtp");
    expect(cfg.smtpUrl).toBe("smtp://tok:tok@smtp.example.com:587");
    expect(cfg.from).toBe("Deskbell <a@b.co>");
  });

  it("refuses half a configuration — an URL without a sender is not SMTP mode", () => {
    const cfg = readEmailConfig(env({ SMTP_URL: "smtp://smtp.example.com" }));
    expect(cfg.mode).not.toBe("smtp");
  });

  it("prints to the console in development when unconfigured", () => {
    expect(readEmailConfig(env({})).mode).toBe("console");
  });

  it("is disabled in production when unconfigured — never pretend to send", () => {
    expect(readEmailConfig(env({ NODE_ENV: "production" })).mode).toBe("disabled");
  });

  it("treats blank values as unset", () => {
    expect(readEmailConfig(env({ SMTP_URL: "   ", EMAIL_FROM: "  " })).mode).toBe("console");
  });
});
