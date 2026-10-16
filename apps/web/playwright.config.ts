import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

import { e2eDatabaseUrl } from "./e2e/database";

// The repository's .env, as every other script loads it (`tsx
// --env-file-if-exists=.env`); absent in CI, where the job sets the variables.
const ENV_FILE = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

/**
 * Browser tests for the dashboard (spec: dashboard-browser-tests).
 *
 * The suite runs against its own database and its own server: global setup
 * builds `<name>_e2e` from DATABASE_URL and seeds it; the web server is
 * `next start` on port 3300 against that database, from the build CI already
 * makes. Locally a server already on the port is reused.
 */
const PORT = 3300;

// The widget specs serve a stand-in host page through request interception
// and load deskbell.js from the server on localhost. Chrome refuses that as a
// private-network access from an origin it cannot place, so those checks are
// off for the widget projects only; nothing else about the browser changes.
const WIDGET_LAUNCH = {
  args: [
    "--disable-features=PrivateNetworkAccessChecks,PrivateNetworkAccessPermissionPrompt,LocalNetworkAccessChecks,LocalNetworkAccessPermissionPrompt",
  ],
};
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // The dashboard projects take every spec at the top level; the widget
    // specs live in ./e2e/widget and belong to the widget projects only.
    {
      name: "desktop",
      testIgnore: /widget\//,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
    {
      name: "phone",
      testIgnore: /widget\//,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 400, height: 800 },
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
    // The widget on a stand-in host page (spec: widget-browser-tests): no
    // dashboard session, a real foreign origin, the seeded project's key.
    // Desktop Chrome's user agent, not the headless one the bot filter refuses.
    {
      name: "widget",
      testMatch: /widget\/.*\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], launchOptions: WIDGET_LAUNCH },
    },
    {
      name: "widget-phone",
      testMatch: /widget\/.*\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 400, height: 800 },
        launchOptions: WIDGET_LAUNCH,
      },
    },
  ],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-only-secret-never-production",
      BETTER_AUTH_URL: BASE_URL,
      NODE_ENV: "production",
      // The getting-started page names the model key the server is missing
      // and says whether an empty allowlist blocks the widget (spec:
      // overview-getting-started). Pinned so a developer's real key or dev
      // override in .env cannot change what the page says locally.
      OPENAI_API_KEY: "",
      DESKBELL_CHAT_MODEL: "openai/gpt-5-mini",
      DESKBELL_EMBEDDING_MODEL: "openai/text-embedding-3-small",
      DESKBELL_ALLOW_ANY_ORIGIN: "false",
      // The sign-in pages render a Google button only when configured
      // (spec: sign-in-with-google); pinned off for the same reason.
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
    },
  },
});
