import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as authSchema from "./auth-schema";
import * as schema from "./schema";

export * from "./auth-schema";
export * from "./gaps";
export * from "./maintenance";
export * from "./retention";
export * from "./schema";
export * from "./usage";

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema: { ...schema, ...authSchema } });
}

/**
 * D12: every query MUST be org-scoped. Access tables through helpers that take
 * an orgId rather than calling db.select() directly — enforced by review +
 * a lint rule (TODO: custom Biome/ESLint rule in .ai/specs).
 * RLS policies (in SQL migrations) are the second, database-level fence.
 */
export function forOrg(db: Database, orgId: string) {
  return { db, orgId };
}
