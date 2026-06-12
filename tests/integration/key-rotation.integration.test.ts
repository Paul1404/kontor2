import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptToString, encryptString } from "~/server/crypto/encrypt";
import {
  assessKeyDropSafety,
  type EncryptedTarget,
  reencryptAllData,
} from "~/server/crypto/reencrypt";
import { db } from "~/server/db/client";
import { _resetEnvCache } from "~/server/env";

/**
 * End-to-end proof that a master-key rotation is lossless against the real
 * database job. Runs `reencryptAllData` over an isolated scratch table (so it
 * never touches real rows or other tests' data) through the full cycle:
 *
 *   write under key A  ->  ring {current: B, previous: [A]}  ->  reencrypt
 *   ->  assert all rows on B  ->  drop A  ->  every value still decrypts.
 *
 * Drives the keyring through the real env path (APP_SECRET / APP_SECRET_PREV),
 * so it exercises exactly what an operator does in production. Only runs against
 * the throwaway test database.
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;

const SCRATCH = "rotation_test_secrets";
const TARGET: EncryptedTarget[] = [{ table: SCRATCH, column: "secret", idColumn: "id" }];

// Two distinct 32-byte masters (64 hex chars each, matching APP_SECRET's shape).
const MASTER_A = "a".repeat(64);
const MASTER_B = "b".repeat(64);

const saved = {
  APP_SECRET: process.env.APP_SECRET,
  APP_SECRET_PREV: process.env.APP_SECRET_PREV,
};

function useMaster(current: string, previous?: string): void {
  process.env.APP_SECRET = current;
  if (previous) process.env.APP_SECRET_PREV = previous;
  else delete process.env.APP_SECRET_PREV;
  _resetEnvCache();
}

function restoreEnv(): void {
  if (saved.APP_SECRET !== undefined) process.env.APP_SECRET = saved.APP_SECRET;
  else delete process.env.APP_SECRET;
  if (saved.APP_SECRET_PREV !== undefined) process.env.APP_SECRET_PREV = saved.APP_SECRET_PREV;
  else delete process.env.APP_SECRET_PREV;
  _resetEnvCache();
}

describe.skipIf(!onTestDb)("lossless key rotation (integration)", () => {
  beforeAll(async () => {
    await db().execute(
      sql`create table if not exists ${sql.identifier(SCRATCH)} (id uuid primary key default gen_random_uuid(), secret bytea)`,
    );
  });

  afterAll(async () => {
    await db().execute(sql`drop table if exists ${sql.identifier(SCRATCH)}`);
    restoreEnv();
  });

  it("rewrites every row onto the new key and stays readable after the old key is dropped", async () => {
    const secrets = ["DE89370400440532013000", "DE12500105170648489890", ""];

    // Phase 1: write everything under key A.
    useMaster(MASTER_A);
    for (const s of secrets) {
      await db().execute(
        sql`insert into ${sql.identifier(SCRATCH)} (secret) values (${encryptString(s)})`,
      );
    }

    // Phase 2: rotate. B current, A kept as previous so old rows still read.
    useMaster(MASTER_B, MASTER_A);

    const before = await assessKeyDropSafety(db(), TARGET);
    expect(before.safe).toBe(false); // rows still on A -> not safe to drop A yet
    expect(before.rowsNotOnCurrentKey).toBe(secrets.length);

    const reports = await reencryptAllData(db(), TARGET);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.rewritten).toBe(secrets.length);
    expect(reports[0]?.failed).toBe(0);

    const after = await assessKeyDropSafety(db(), TARGET);
    expect(after.safe).toBe(true); // everything on B now -> A may be dropped

    // Phase 3: drop A entirely. Every value must still decrypt under B alone.
    useMaster(MASTER_B);
    const rows = (await db().execute(
      sql`select secret from ${sql.identifier(SCRATCH)}`,
    )) as unknown as Array<{ secret: Buffer }>;
    const decoded = rows.map((r) => decryptToString(r.secret)).sort();
    expect(decoded).toEqual([...secrets].sort());
  });
});
