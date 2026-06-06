import { sql } from "drizzle-orm";
import { decryptWithRing, encryptWithRing, inspectCiphertext } from "~/server/crypto/encrypt";
import type { DB } from "~/server/db/client";
import { env } from "~/server/env";

export type ReencryptReport = {
  table: string;
  column: string;
  scanned: number;
  rewritten: number;
  skippedAlreadyCurrent: number;
  failed: number;
  failedIds: string[];
};

export type EncryptedTarget = {
  table: string;
  column: string;
  idColumn: string;
};

/** Every column persisted via the `encryptedText` Drizzle custom type. */
export const ENCRYPTED_TARGETS: EncryptedTarget[] = [
  { table: "members", column: "iban1", idColumn: "id" },
  { table: "organization_settings", column: "vereins_iban", idColumn: "id" },
  { table: "smtp_config", column: "password_encrypted", idColumn: "id" },
];

/**
 * Re-encrypts every encrypted bytea column under the current keyring key.
 * Skips rows already on the current key (cheap fingerprint check), so the
 * job is idempotent and re-runnable. Rows that fail to decrypt (e.g. the key
 * is no longer in the keyring) are reported in `failedIds` and left intact;
 * the caller can add the missing key to APP_SECRET_PREV and retry.
 *
 * Uses raw SQL to bypass the Drizzle `encryptedText` customType — that type
 * would auto-decrypt on read and throw on legacy ciphertexts whose key is
 * not the current one.
 */
export async function reencryptAllData(db: DB): Promise<ReencryptReport[]> {
  const reports: ReencryptReport[] = [];
  for (const target of ENCRYPTED_TARGETS) {
    reports.push(await reencryptBlobColumn(db, target));
  }
  return reports;
}

async function reencryptBlobColumn(db: DB, target: EncryptedTarget): Promise<ReencryptReport> {
  const ring = env().encryptionKeyring;
  const currentFp = ring.current.fingerprint;
  const report: ReencryptReport = {
    table: target.table,
    column: target.column,
    scanned: 0,
    rewritten: 0,
    skippedAlreadyCurrent: 0,
    failed: 0,
    failedIds: [],
  };

  const tableRef = sql.identifier(target.table);
  const colRef = sql.identifier(target.column);
  const idRef = sql.identifier(target.idColumn);

  const rows = (await db.execute(
    sql`select ${idRef} as id, ${colRef} as v from ${tableRef} where ${colRef} is not null`,
  )) as unknown as Array<{ id: string | number; v: Buffer | null }>;

  for (const row of rows) {
    if (!row.v) continue;
    report.scanned += 1;
    const info = inspectCiphertext(row.v);
    if (info?.version === 2 && info.fingerprint.equals(currentFp)) {
      report.skippedAlreadyCurrent += 1;
      continue;
    }
    try {
      const plain = decryptWithRing(ring, row.v);
      const fresh = encryptWithRing(ring, plain);
      await db.execute(sql`update ${tableRef} set ${colRef} = ${fresh} where ${idRef} = ${row.id}`);
      report.rewritten += 1;
    } catch (err) {
      report.failed += 1;
      report.failedIds.push(String(row.id));
      console.error(
        `[reencrypt] ${target.table}.${target.column} id=${row.id} failed: ${(err as Error).message}`,
      );
    }
  }

  return report;
}

export type InspectReport = {
  table: string;
  column: string;
  total: number;
  onCurrentKey: number;
  onPreviousKey: number;
  legacyV1: number;
  unknown: number;
};

/** Dry-run summary: counts rows per key fingerprint without rewriting anything. */
export async function inspectEncryptedData(db: DB): Promise<InspectReport[]> {
  const ring = env().encryptionKeyring;
  const currentFp = ring.current.fingerprint;
  const prevFps = ring.previous.map((k) => k.fingerprint);

  const results: InspectReport[] = [];
  for (const target of ENCRYPTED_TARGETS) {
    const tableRef = sql.identifier(target.table);
    const colRef = sql.identifier(target.column);
    const rows = (await db.execute(
      sql`select ${colRef} as v from ${tableRef} where ${colRef} is not null`,
    )) as unknown as Array<{ v: Buffer | null }>;

    let onCurrent = 0;
    let onPrev = 0;
    let legacy = 0;
    let unknown = 0;
    for (const r of rows) {
      if (!r.v) continue;
      const info = inspectCiphertext(r.v);
      if (info === null) {
        unknown += 1;
      } else if (info.version === 1) {
        legacy += 1;
      } else if (info.fingerprint.equals(currentFp)) {
        onCurrent += 1;
      } else if (prevFps.some((fp) => fp.equals(info.fingerprint))) {
        onPrev += 1;
      } else {
        unknown += 1;
      }
    }
    results.push({
      table: target.table,
      column: target.column,
      total: rows.length,
      onCurrentKey: onCurrent,
      onPreviousKey: onPrev,
      legacyV1: legacy,
      unknown,
    });
  }
  return results;
}
