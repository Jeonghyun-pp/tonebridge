import "dotenv/config";
import type { Config } from "drizzle-kit";

if (!process.env.SUPABASE_DB_URL) {
  throw new Error("SUPABASE_DB_URL is required in .env.local for drizzle-kit");
}

export default {
  schema: "./lib/db/schema.ts",
  out: "./supabase/migrations-drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.SUPABASE_DB_URL,
  },
  strict: true,
  verbose: true,
} satisfies Config;
