import { sql } from "drizzle-orm";
import type { DBOrTx } from "~/server/db/client";
import { documentSequencesTable } from "~/server/db/schema/document-sequences";

/**
 * Allocate the next unique, human-readable document reference for a given
 * prefix and year, e.g. "MA-2026-0042". Backed by an atomic upsert on
 * `document_sequences`, so concurrent runs never hand out the same number.
 *
 * The reference may skip numbers if a generation later fails (the number is
 * already consumed); gaps in document references are acceptable and expected.
 *
 * Pass a transaction (`tx`) when the reference should roll back together with
 * the rest of a generation, or the plain `db` handle for a standalone alloc
 * (the upsert is a single atomic statement either way).
 */
export async function allocateDocRef(db: DBOrTx, prefix: string, year: number): Promise<string> {
  const [row] = await db
    .insert(documentSequencesTable)
    .values({ prefix, year, lastSeq: 1 })
    .onConflictDoUpdate({
      target: [documentSequencesTable.prefix, documentSequencesTable.year],
      set: { lastSeq: sql`${documentSequencesTable.lastSeq} + 1` },
    })
    .returning({ lastSeq: documentSequencesTable.lastSeq });
  const seq = row?.lastSeq ?? 1;
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}
