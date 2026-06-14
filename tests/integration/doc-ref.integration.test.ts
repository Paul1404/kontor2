import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/server/db/client";
import { allocateDocRef } from "~/server/db/doc-ref";
import { documentRefsTable } from "~/server/db/schema/document-refs";
import { documentSequencesTable } from "~/server/db/schema/document-sequences";

/**
 * Coverage for the two-flavour document reference allocator: random/opaque for
 * most document types, sequential for invoices (RG). Uses a far-future year so
 * it never collides with real document numbers.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const YEAR = 9999;
const RANDOM_RE = /^ANT-9999-[0-9A-HJKMNP-TV-Z]{6}$/;

describe.skipIf(!onTestDb)("allocateDocRef (integration)", () => {
  afterAll(async () => {
    await db().delete(documentRefsTable).where(eq(documentRefsTable.year, YEAR));
    await db().delete(documentSequencesTable).where(eq(documentSequencesTable.year, YEAR));
  });

  it("hands out random, non-sequential, unique references for normal prefixes", async () => {
    const refs = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      const ref = await allocateDocRef(db(), "ANT", YEAR);
      expect(ref).toMatch(RANDOM_RE);
      refs.add(ref);
    }
    // All unique...
    expect(refs.size).toBe(25);
    // ...and not a running counter: the numeric tail is not 0001..0025.
    const looksSequential = [...refs].every((r) => /-\d{4}$/.test(r));
    expect(looksSequential).toBe(false);
  });

  it("keeps invoice (RG) references sequential", async () => {
    const a = await allocateDocRef(db(), "RG", YEAR);
    const b = await allocateDocRef(db(), "RG", YEAR);
    expect(a).toMatch(/^RG-9999-\d{4}$/);
    expect(b).toMatch(/^RG-9999-\d{4}$/);
    const seqA = Number(a.slice(-4));
    const seqB = Number(b.slice(-4));
    expect(seqB).toBe(seqA + 1);
  });
});
