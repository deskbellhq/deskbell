/**
 * The browser suite's database (spec: dashboard-browser-tests): the
 * developer's DATABASE_URL with `_e2e` appended to the database name, so the
 * suite can create, wipe and seed it without ever touching the database the
 * developer works in. Shared by the Playwright config and the seed.
 */
export function e2eDatabaseUrl(base: string | undefined = process.env.DATABASE_URL): string {
  if (!base)
    throw new Error("DATABASE_URL is not set — the browser suite derives its database from it");
  const url = new URL(base);
  const name = url.pathname.replace(/^\//, "");
  if (!name) throw new Error(`DATABASE_URL names no database: ${base}`);
  if (name.endsWith("_e2e")) return base;
  url.pathname = `/${name}_e2e`;
  return url.toString();
}

/** The same server, the maintenance database — where CREATE DATABASE runs. */
export function adminDatabaseUrl(base: string | undefined = process.env.DATABASE_URL): string {
  if (!base) throw new Error("DATABASE_URL is not set");
  const url = new URL(base);
  url.pathname = "/postgres";
  return url.toString();
}
