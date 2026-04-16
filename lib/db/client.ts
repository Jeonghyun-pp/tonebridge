/**
 * Drizzle ORM client for typed DB access.
 * For connection pooling in serverless, we use postgres-js with prepare=false.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  throw new Error("SUPABASE_DB_URL is required for drizzle client");
}

// `prepare: false` is required for Supabase pooler (PgBouncer transaction mode)
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
export type DB = typeof db;
