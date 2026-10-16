import { createDb, type Database } from "@deskbell/db";

// createDb() opens a new pg Pool per call — cache one per process, on
// globalThis so it survives Next dev HMR module reloads.
const globalForDb = globalThis as unknown as { deskbellDb?: Database };

export function getDb(): Database {
  globalForDb.deskbellDb ??= createDb();
  return globalForDb.deskbellDb;
}
