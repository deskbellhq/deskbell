import { seedBrowserSuite } from "./seed";

/** Runs once before every project: a fresh, deterministic database. */
export default async function globalSetup(): Promise<void> {
  await seedBrowserSuite();
}
