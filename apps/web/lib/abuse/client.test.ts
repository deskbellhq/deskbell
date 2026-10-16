import { describe, expect, it } from "vitest";

import { clientIp, hashIp, isBotUserAgent } from "./client";

const headers = (init: Record<string, string>) => new Headers(init);

describe("clientIp", () => {
  it("reads x-forwarded-for from the right, not the left", () => {
    // The client claimed 1.1.1.1; our own proxy appended 9.9.9.9. Reading from
    // the left would hand every attacker unlimited identities.
    const h = headers({ "x-forwarded-for": "1.1.1.1, 8.8.8.8, 9.9.9.9" });
    expect(clientIp(h, 0)).toBe("9.9.9.9");
  });

  it("skips the configured number of trusted hops", () => {
    const h = headers({ "x-forwarded-for": "1.1.1.1, 8.8.8.8, 9.9.9.9" });
    expect(clientIp(h, 1)).toBe("8.8.8.8");
    expect(clientIp(h, 2)).toBe("1.1.1.1");
  });

  it("falls back to the leftmost entry when the chain is shorter than configured", () => {
    // Misconfiguration: a spoofable identity still rate-limits honest traffic.
    const h = headers({ "x-forwarded-for": "1.1.1.1" });
    expect(clientIp(h, 3)).toBe("1.1.1.1");
  });

  it("falls back to x-real-ip when there is no forwarded chain", () => {
    expect(clientIp(headers({ "x-real-ip": "203.0.113.7" }), 0)).toBe("203.0.113.7");
  });

  it("returns null when the request carries no address at all", () => {
    expect(clientIp(headers({}), 0)).toBeNull();
  });

  it("strips an IPv4 port but leaves IPv6 intact", () => {
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.7:51234" }), 0)).toBe("203.0.113.7");
    expect(clientIp(headers({ "x-forwarded-for": "2001:db8::1" }), 0)).toBe("2001:db8::1");
    expect(clientIp(headers({ "x-forwarded-for": "[2001:db8::1]:443" }), 0)).toBe("2001:db8::1");
  });

  it("collapses an IPv6 zone id so one client is one bucket", () => {
    expect(clientIp(headers({ "x-forwarded-for": "fe80::1%eth0" }), 0)).toBe("fe80::1");
  });
});

describe("hashIp", () => {
  it("is stable for one address and different for another", () => {
    expect(hashIp("203.0.113.7", "salt")).toBe(hashIp("203.0.113.7", "salt"));
    expect(hashIp("203.0.113.8", "salt")).not.toBe(hashIp("203.0.113.7", "salt"));
  });

  it("changes with the salt, so one deployment's buckets say nothing about another's", () => {
    expect(hashIp("203.0.113.7", "a")).not.toBe(hashIp("203.0.113.7", "b"));
  });

  it("never contains the address it came from", () => {
    expect(hashIp("203.0.113.7", "salt")).not.toContain("203.0.113.7");
  });
});

describe("isBotUserAgent", () => {
  it("catches self-identifying crawlers and default library agents", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
      "AdsBot-Google (+http://www.google.com/adsbot.html)",
      "curl/8.4.0",
      "python-requests/2.31.0",
      "Go-http-client/1.1",
      "axios/1.7.2",
      "node-fetch/1.0",
    ]) {
      expect(isBotUserAgent(ua), ua).toBe(true);
    }
  });

  it("leaves real browsers alone", () => {
    for (const ua of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
      // A real Android phone whose model name contains "bot" — the reason the
      // pattern requires a delimiter after it.
      "Mozilla/5.0 (Linux; Android 10; CUBOT_X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    ]) {
      expect(isBotUserAgent(ua), ua).toBe(false);
    }
  });

  it("treats a missing or empty User-Agent as non-browser", () => {
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent("   ")).toBe(true);
  });
});
