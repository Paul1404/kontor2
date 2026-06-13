import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "~/server/db/schema";
import { env } from "~/server/env";

type Pool = { sql: postgres.Sql; db: ReturnType<typeof drizzle<typeof schema>> };

// One connection pool per database URL, so each Verein (tenant) gets its own
// pool, lazily opened on first use and reused afterwards. With a single tenant
// every lookup resolves to the same URL, so this behaves exactly like the old
// single-instance client.
const pools = new Map<string, Pool>();

function poolFor(databaseUrl: string): Pool {
  let pool = pools.get(databaseUrl);
  if (!pool) {
    const s = postgres(databaseUrl, {
      max: env().NODE_ENV === "production" ? 10 : 4,
      // Suppress harmless NOTICEs (table exists, etc.) from startup logs.
      onnotice: () => {},
      prepare: false,
    });
    pool = { sql: s, db: drizzle(s, { schema, casing: "snake_case" }) };
    pools.set(databaseUrl, pool);
  }
  return pool;
}

/** Drizzle handle for a specific tenant database. */
export function dbForTenant(databaseUrl: string): Pool["db"] {
  return poolFor(databaseUrl).db;
}

/** Raw postgres handle for a specific tenant database. */
export function sqlForTenant(databaseUrl: string): postgres.Sql {
  return poolFor(databaseUrl).sql;
}

/** Primary tenant handle (from `DATABASE_URL`). Use for background jobs and
 * scripts; request-scoped code should use the per-request `context.db`. */
export function db() {
  return dbForTenant(env().DATABASE_URL);
}

export function sql(): postgres.Sql {
  return sqlForTenant(env().DATABASE_URL);
}

/**
 * Verbindung zur Control-Plane-DB (`CONTROL_DATABASE_URL`), in der die
 * `tenants`-Registry und die Operator-Accounts der Betreiber-Console leben.
 * Fällt auf `DATABASE_URL` zurück, solange keine eigene Control-DB gesetzt ist
 * -- dann ist es exakt der bisherige Stand (Registry in der Primär-DB).
 */
export function controlDbUrl(): string {
  return env().CONTROL_DATABASE_URL || env().DATABASE_URL;
}

export function controlDb() {
  return dbForTenant(controlDbUrl());
}

/**
 * Close every open Postgres pool. No-op when nothing was opened (e.g. SIGTERM
 * before the first request). Resets the cache so a later `db()` reconnects.
 * Called from the graceful-shutdown path so connections drain instead of being
 * reset under the server.
 */
export async function closeDb(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map((p) => p.sql.end({ timeout: 5 })));
}

export type DB = ReturnType<typeof db>;

/**
 * Either the top-level DB handle or a transaction. Use for functions that
 * write to the audit log from inside a `db.transaction(async tx => ...)`
 * block, where passing `tx` should be type-safe.
 */
export type DBOrTx = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];
