#!/usr/bin/env node --experimental-strip-types
/**
 * Production-safe Drizzle migrator. Uses the runtime migrator only (no
 * drizzle-kit), so this script can be run inside the slim container where
 * dev dependencies are absent.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL is not set");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: "./drizzle/migrations" });
    console.log("[migrate] ok");
  } catch (err) {
    console.error("[migrate] failed:", (err as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
