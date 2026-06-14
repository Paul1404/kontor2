import { sql } from "drizzle-orm";
import type { DBOrTx } from "~/server/db/client";
import { documentRefsTable } from "~/server/db/schema/document-refs";
import { documentSequencesTable } from "~/server/db/schema/document-sequences";

/**
 * Document references come in two flavours:
 *
 * - **Random** (the default): an opaque, non-sequential code like
 *   "ANT-2026-7K3QF9" that, like the app-owned member numbers, carries no order
 *   or count information. Knowing one reference tells you nothing about how many
 *   documents exist or in what order they were created.
 * - **Sequential**: a running counter like "RG-2026-0042". Reserved for the few
 *   document types that must stay gap-aware and ordered. Invoices (`RG`) keep
 *   this because a German Rechnungsnummer is expected to be a fortlaufende
 *   Nummer (§14 UStG).
 *
 * The prefix decides which flavour applies, so callers do not change.
 */
const SEQUENTIAL_PREFIXES = new Set<string>(["RG"]);

/** Crockford base32 minus the ambiguous I, L, O, U. Exactly 32 symbols. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 32^6 ≈ 1.07 billion codes per (prefix, year): ample for a club. */
const BODY_LENGTH = 6;
/** Regenerate on the (astronomically rare) collision before giving up. */
const MAX_ATTEMPTS = 6;

function randomBody(): string {
  const bytes = new Uint8Array(BODY_LENGTH);
  crypto.getRandomValues(bytes);
  // 32 divides 256 evenly, so masking with 0x1f is unbiased.
  let body = "";
  for (let i = 0; i < BODY_LENGTH; i += 1) body += ALPHABET.charAt((bytes[i] ?? 0) & 0x1f);
  return body;
}

/**
 * Allocate the next unique document reference for a given prefix and year.
 *
 * Random by default (see module docs); sequential for the prefixes in
 * {@link SEQUENTIAL_PREFIXES}. Both guarantee uniqueness atomically and are
 * safe to call inside a transaction (`tx`) so the reference rolls back with the
 * rest of a generation. Gaps are acceptable and expected for both flavours.
 */
export async function allocateDocRef(db: DBOrTx, prefix: string, year: number): Promise<string> {
  if (SEQUENTIAL_PREFIXES.has(prefix)) return allocateSequentialRef(db, prefix, year);
  return allocateRandomRef(db, prefix, year);
}

/**
 * Random allocation: generate a candidate and claim it in `document_refs`.
 * `on conflict do nothing` returns no row on a clash (and, crucially, does not
 * raise — so it never aborts an enclosing transaction); we then retry with a
 * fresh body. Collisions are vanishingly unlikely, so the loop almost always
 * succeeds on the first attempt.
 */
async function allocateRandomRef(db: DBOrTx, prefix: string, year: number): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const ref = `${prefix}-${year}-${randomBody()}`;
    const claimed = await db
      .insert(documentRefsTable)
      .values({ ref, prefix, year })
      .onConflictDoNothing({ target: documentRefsTable.ref })
      .returning({ ref: documentRefsTable.ref });
    if (claimed.length > 0) return ref;
  }
  throw new Error(
    `Konnte keine eindeutige Dokumentnummer fuer ${prefix}-${year} erzeugen (${MAX_ATTEMPTS} Versuche).`,
  );
}

/**
 * Sequential allocation: an atomic upsert on `document_sequences` bumps the
 * per-(prefix, year) counter so concurrent runs never share a number.
 */
async function allocateSequentialRef(db: DBOrTx, prefix: string, year: number): Promise<string> {
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
