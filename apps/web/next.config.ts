import path from "node:path";
import type { NextConfig } from "next";

// Monorepo dev: next dev's cwd is apps/web, so the root .env is invisible to
// it. loadEnvFile never overrides already-set vars — real env (Docker) wins.
try {
  process.loadEnvFile(path.join(import.meta.dirname, "../../.env"));
} catch {
  // no .env — rely on process env (Docker, CI)
}

const nextConfig: NextConfig = {
  // Self-hosting (D11): standalone output for a minimal Docker image.
  output: "standalone",
  // Monorepo: trace from the workspace root so pnpm-linked deps
  // (e.g. @swc/helpers) land in the standalone output.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  // Workspace packages export TS source; Next transpiles them.
  transpilePackages: [
    "@deskbell/connectors",
    "@deskbell/core",
    "@deskbell/db",
    "@deskbell/shared",
    "@deskbell/ui",
  ],
  // Node-native packages stay external to the server bundle.
  serverExternalPackages: ["pg"],
  // Old homes of the settings pages (spec: dashboard-ia-settings). Temporary
  // on purpose: 308s are cached too aggressively for a pre-1.0 layout that
  // may shuffle again. These run before proxy.ts, so the old segments are
  // gone from its matcher.
  async redirects() {
    return [
      { source: "/settings", destination: "/settings/account", permanent: false },
      { source: "/members", destination: "/settings/members", permanent: false },
      { source: "/appearance", destination: "/settings/appearance", permanent: false },
    ];
  },
};

export default nextConfig;
