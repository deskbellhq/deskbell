import { createDb, type Database } from "@deskbell/db";

let db: Database | undefined;

export function getDb(): Database {
  db ??= createDb();
  return db;
}
