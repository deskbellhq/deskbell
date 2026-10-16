import { describe, expect, it, vi } from "vitest";

import type { EmailConfig } from "./config";
import { EmailDisabledError, sendEmail } from "./mailer";

const MAIL = { to: "user@example.com", subject: "Hello", text: "Body" };

describe("sendEmail", () => {
  it("sends through the transport with the configured sender in smtp mode", async () => {
    const transport = { sendMail: vi.fn().mockResolvedValue(undefined) };
    const config: EmailConfig = {
      mode: "smtp",
      smtpUrl: "smtp://smtp.example.com",
      from: "Deskbell <no-reply@example.com>",
    };
    await sendEmail(MAIL, config, transport);
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: "Deskbell <no-reply@example.com>",
      ...MAIL,
    });
  });

  it("prints instead of sending in console mode", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await sendEmail(MAIL, { mode: "console", smtpUrl: null, from: null });
      expect(log).toHaveBeenCalledOnce();
      expect(log.mock.calls[0]?.[0]).toContain("user@example.com");
      expect(log.mock.calls[0]?.[0]).toContain("Body");
    } finally {
      log.mockRestore();
    }
  });

  it("throws when disabled — callers must not believe a mail went out", async () => {
    await expect(
      sendEmail(MAIL, { mode: "disabled", smtpUrl: null, from: null }),
    ).rejects.toBeInstanceOf(EmailDisabledError);
  });
});
