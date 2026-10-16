import { defineConfig } from "drizzle-kit";

// drizzle-kit runs with cwd = packages/db; the env file lives at the repo root.
try {
  process.loadEnvFile("../../.env");
} catch {
  // no .env (CI, docker) — DATABASE_URL comes from the process environment
}

export default defineConfig({
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    // biome-ignore lint/style/noNonNullAssertion: fails loudly at CLI time if unset
    url: process.env.DATABASE_URL!,
  },
});
