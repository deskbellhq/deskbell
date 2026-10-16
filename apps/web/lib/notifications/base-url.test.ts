import { describe, expect, it } from "vitest";
import { notificationBaseUrl } from "./base-url";

describe("notificationBaseUrl", () => {
  it("prefers the public URL, then the auth URL, then localhost", () => {
    expect(
      notificationBaseUrl({
        DESKBELL_PUBLIC_URL: "https://deskbell.example/path",
        BETTER_AUTH_URL: "https://auth.example",
      }),
    ).toBe("https://deskbell.example");
    expect(notificationBaseUrl({ BETTER_AUTH_URL: "https://auth.example" })).toBe(
      "https://auth.example",
    );
    expect(notificationBaseUrl({ DESKBELL_PUBLIC_URL: "garbage" })).toBe("http://localhost:3000");
  });
});
