import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "~/server/db/schema";
import { env } from "~/server/env";

let sqlInstance: postgres.Sql | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function sql(): postgres.Sql {
  if (!sqlInstance) {
    sqlInstance = postgres(env().DATABASE_URL, {
      max: env().NODE_ENV === "production" ? 10 : 4,
      // Suppress harmless NOTICEs (table exists, etc.) from startup logs.
      onnotice: () => {},
      prepare: false,
    });
  }
  return sqlInstance;
}

export function db() {
  if (!dbInstance) {
    dbInstance = drizzle(sql(), { schema, casing: "snake_case" });
  }
  return dbInstance;
}

/**
 * Close the Postgres pool if one was opened. No-op when the lazy `sql()` was
 * never called (e.g. SIGTERM before the first request). Resets the memoized
 * handles so a later `db()` would reconnect. Called from the graceful-shutdown
 * path so connections drain instead of being reset under the server.
 */
export async function closeDb(): Promise<void> {
  if (!sqlInstance) return;
  const instance = sqlInstance;
  sqlInstance = undefined;
  dbInstance = undefined;
  await instance.end({ timeout: 5 });
}

export type DB = ReturnType<typeof db>;

/**
 * Either the top-level DB handle or a transaction. Use for functions that
 * write to the audit log from inside a `db.transaction(async tx => ...)`
 * block, where passing `tx` should be type-safe.
 */
export type DBOrTx = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];
