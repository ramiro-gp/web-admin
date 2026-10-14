import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const databaseGlobal = globalThis as typeof globalThis & {
  webAdminPool?: Pool;
  webAdminDb?: Database;
};

/** Creates a connection only when a protected server operation needs it. */
export function getDb(): Database {
  if (databaseGlobal.webAdminDb) return databaseGlobal.webAdminDb;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new ConfigError("DATABASE_URL no está configurada. Revisá .env.local.");
  const pool = databaseGlobal.webAdminPool ?? new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    application_name: "web-admin",
  });
  // Fluid compute drains idle connections before suspending a Vercel instance.
  if (process.env.VERCEL && !databaseGlobal.webAdminPool) attachDatabasePool(pool);
  databaseGlobal.webAdminPool = pool;
  databaseGlobal.webAdminDb = drizzle(pool, { schema });
  return databaseGlobal.webAdminDb;
}
