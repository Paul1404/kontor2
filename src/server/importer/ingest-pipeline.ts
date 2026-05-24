import { eq, inArray, or, sql } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { contractsTable } from "~/server/db/schema/contracts";
import { feeTypesTable } from "~/server/db/schema/fee-types";
import { importBatchesTable } from "~/server/db/schema/import-batches";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { appendAudit, diff } from "~/server/audit/log";
import { invalidateMemberCaches } from "~/server/search/cache";
import { splitAbteilung, slugify } from "~/server/importer/abteilung-splitter";
import {
  mapContractRow,
  mapFeeTypeRow,
  mapInterRow,
  mapInteresRow,
  mapMemberRow,
  mapSepaRow,
  mapVerknRow,
  type LinearRow,
} from "~/server/importer/linear-mapper";

export type IngestInput = {
  source: "sql_upload" | "svums_push";
  filename?: string | null;
  fileSizeBytes?: number | null;
  startedBy?: string | null;
  startedByEmail?: string | null;
  members?: LinearRow[];
  feeTypes?: LinearRow[];
  contracts?: LinearRow[];
  sepa?: LinearRow[];
  relationships?: LinearRow[];
  /** Linear `inter` lookup table (Nr → Interesse/Abteilung name). */
  inter?: LinearRow[];
  /** Linear `interes` table — per-member Abteilungs-Mitgliedschaft. */
  interes?: LinearRow[];
  requestId?: string | null;
  /**
   * When true, member→Abteilung links are wiped for the AdrNrs in this batch
   * before re-creating them from the dump. This makes Linear the source of
   * truth for the assignment, at the cost of losing any links added manually
   * in the UI after the previous import.
   */
  forceOverwriteAbteilungLinks?: boolean;
};

export type IngestResult = {
  batchId: string;
  membersWritten: number;
  membersCreated: number;
  membersUpdated: number;
  feeTypesWritten: number;
  contractsWritten: number;
  sepaWritten: number;
  relationshipsWritten: number;
  abteilungenLinked: number;
  errors: Array<{ table: string; message: string }>;
};

export async function runIngest(db: DB, input: IngestInput): Promise<IngestResult> {
  const auditSource = input.source === "sql_upload" ? "import" : "svums_push";
  const errors: IngestResult["errors"] = [];

  const [batch] = await db
    .insert(importBatchesTable)
    .values({
      source: input.source,
      filename: input.filename ?? null,
      fileSizeBytes: input.fileSizeBytes ?? null,
      startedBy: input.startedBy ?? null,
    })
    .returning({ id: importBatchesTable.id });
  if (!batch) throw new Error("Could not create import batch");

  // 1. Fee types: upsert by `art`.
  let feeTypesWritten = 0;
  for (const raw of input.feeTypes ?? []) {
    try {
      const row = mapFeeTypeRow(raw);
      if (!row) continue;
      await db
        .insert(feeTypesTable)
        .values({ ...row, importBatchId: batch.id, updatedAt: new Date() } as never)
        .onConflictDoUpdate({
          target: feeTypesTable.art,
          set: { ...row, importBatchId: batch.id, updatedAt: new Date() } as never,
        });
      feeTypesWritten += 1;
    } catch (e) {
      errors.push({ table: "mgart", message: (e as Error).message });
    }
  }

  // 2. Members: upsert by `adr_nr`. Collect created/updated stats for audit.
  let membersCreated = 0;
  let membersUpdated = 0;
  const adrNrToMemberId = new Map<number, string>();
  const abteilungByName = new Map<string, string>(); // name → abteilung.id

  // Preload existing Abteilungen so we don't insert duplicates per row.
  for (const a of await db.select().from(abteilungenTable)) {
    abteilungByName.set(a.name.toLowerCase(), a.id);
  }

  // Force-overwrite mode: wipe the existing Abteilungs-Mitgliedschaften for
  // members that are in the incoming dump, so the upsert below re-creates them
  // exactly as Linear has them now.
  if (input.forceOverwriteAbteilungLinks) {
    const incomingAdrNrs = (input.members ?? [])
      .map((r) => Number(r.AdrNr ?? r.adr_nr ?? r.adrNr))
      .filter((n) => Number.isFinite(n)) as number[];
    if (incomingAdrNrs.length > 0) {
      const existing = await db
        .select({ id: membersTable.id })
        .from(membersTable)
        .where(inArray(membersTable.adrNr, incomingAdrNrs));
      const ids = existing.map((r) => r.id);
      if (ids.length > 0) {
        await db
          .delete(memberAbteilungenTable)
          .where(inArray(memberAbteilungenTable.memberId, ids));
      }
    }
  }

  for (const raw of input.members ?? []) {
    try {
      const row = mapMemberRow(raw);
      if (!row) continue;
      const adrNr = row.adrNr as number;

      const existing = (
        await db.select().from(membersTable).where(eq(membersTable.adrNr, adrNr)).limit(1)
      )[0];

      let memberId: string;
      if (existing) {
        const changes = diff(existing as unknown as Record<string, unknown>, row);
        await db
          .update(membersTable)
          .set({ ...row, updatedAt: new Date(), importBatchId: batch.id } as never)
          .where(eq(membersTable.adrNr, adrNr));
        memberId = existing.id;
        if (Object.keys(changes).length > 0) {
          await appendAudit(db, {
            entityType: "member",
            entityId: memberId,
            action: "update",
            source: auditSource,
            actorId: input.startedBy ?? null,
            actorEmail: input.startedByEmail ?? null,
            changes,
            requestId: input.requestId ?? null,
          });
          membersUpdated += 1;
        }
      } else {
        const [inserted] = await db
          .insert(membersTable)
          .values({ ...row, importBatchId: batch.id } as never)
          .returning({ id: membersTable.id });
        if (!inserted) continue;
        memberId = inserted.id;
        await appendAudit(db, {
          entityType: "member",
          entityId: memberId,
          action: "create",
          source: auditSource,
          actorId: input.startedBy ?? null,
          actorEmail: input.startedByEmail ?? null,
          changes: diff(null, row),
          requestId: input.requestId ?? null,
        });
        membersCreated += 1;
      }
      adrNrToMemberId.set(adrNr, memberId);

      // 2b. Abteilungen many-to-many derivation from the Linear string.
      const names = splitAbteilung((row as Record<string, unknown>).abteilung as string | null);
      for (const name of names) {
        let aid = abteilungByName.get(name.toLowerCase());
        if (!aid) {
          const [created] = await db
            .insert(abteilungenTable)
            .values({ name, slug: slugify(name) })
            .onConflictDoNothing({ target: abteilungenTable.name })
            .returning({ id: abteilungenTable.id });
          if (created) aid = created.id;
          else {
            const [existing2] = await db
              .select({ id: abteilungenTable.id })
              .from(abteilungenTable)
              .where(eq(abteilungenTable.name, name))
              .limit(1);
            aid = existing2?.id;
          }
          if (aid) abteilungByName.set(name.toLowerCase(), aid);
        }
        if (!aid) continue;
        const eintritt = (row as Record<string, unknown>).eintritt as Date | null;
        const austritt = (row as Record<string, unknown>).austritt as Date | null;
        const dateStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
        const eintrittsdatum = dateStr(eintritt) ?? "1900-01-01";
        await db
          .insert(memberAbteilungenTable)
          .values({
            memberId,
            abteilungId: aid,
            eintrittsdatum,
            austrittsdatum: dateStr(austritt),
          })
          .onConflictDoNothing();
      }
    } catch (e) {
      errors.push({ table: "adresse", message: (e as Error).message });
    }
  }

  // 3. Contracts: replace all rows belonging to imported AdrNrs in this batch.
  const adrNrs = [...adrNrToMemberId.keys()];
  let contractsWritten = 0;
  if ((input.contracts?.length ?? 0) > 0 && adrNrs.length > 0) {
    await db.delete(contractsTable).where(inArray(contractsTable.adrNr, adrNrs));
    for (const raw of input.contracts ?? []) {
      try {
        const row = mapContractRow(raw);
        if (!row) continue;
        const memberId = adrNrToMemberId.get(row.adrNr as number);
        if (!memberId) continue;
        await db.insert(contractsTable).values({
          ...row,
          memberId,
          importBatchId: batch.id,
          updatedAt: new Date(),
        } as never);
        contractsWritten += 1;
      } catch (e) {
        errors.push({ table: "mgvert", message: (e as Error).message });
      }
    }
  }

  // 4. SEPA mandates: same strategy as contracts.
  let sepaWritten = 0;
  if ((input.sepa?.length ?? 0) > 0 && adrNrs.length > 0) {
    await db.delete(sepaMandatesTable).where(inArray(sepaMandatesTable.adrNr, adrNrs));
    for (const raw of input.sepa ?? []) {
      try {
        const row = mapSepaRow(raw);
        if (!row) continue;
        const memberId = adrNrToMemberId.get(row.adrNr as number);
        if (!memberId) continue;
        await db.insert(sepaMandatesTable).values({
          ...row,
          memberId,
          importBatchId: batch.id,
          updatedAt: new Date(),
        } as never);
        sepaWritten += 1;
      } catch (e) {
        errors.push({ table: "adrsepa", message: (e as Error).message });
      }
    }
  }

  // 5. Relationships (verkn): replace rows touching any imported AdrNr on
  // either side, then upsert. Linear keeps reciprocal pairs as separate
  // rows, so we preserve direction.
  let relationshipsWritten = 0;
  if ((input.relationships?.length ?? 0) > 0 && adrNrs.length > 0) {
    await db
      .delete(relationshipsTable)
      .where(
        or(
          inArray(relationshipsTable.fromAdrNr, adrNrs),
          inArray(relationshipsTable.toAdrNr, adrNrs),
        ),
      );
    for (const raw of input.relationships ?? []) {
      try {
        const row = mapVerknRow(raw);
        if (!row) continue;
        const fromMemberId = adrNrToMemberId.get(row.fromAdrNr as number);
        if (!fromMemberId) continue;
        const toMemberId = adrNrToMemberId.get(row.toAdrNr as number) ?? null;
        await db
          .insert(relationshipsTable)
          .values({
            ...row,
            fromMemberId,
            toMemberId,
            importBatchId: batch.id,
            updatedAt: new Date(),
          } as never)
          .onConflictDoUpdate({
            target: [relationshipsTable.fromAdrNr, relationshipsTable.toAdrNr],
            set: {
              ...row,
              fromMemberId,
              toMemberId,
              importBatchId: batch.id,
              updatedAt: new Date(),
            } as never,
          });
        relationshipsWritten += 1;
      } catch (e) {
        errors.push({ table: "verkn", message: (e as Error).message });
      }
    }
  }

  // 6. Per-member Abteilungs-Mitgliedschaften from Linear's `interes` table.
  // Linear stores them as numeric FKs into `inter` (and *also* sometimes
  // duplicates the name into `adresse.Abteilung` as a comma-separated list,
  // handled at step 2b above). Most exports carry only one of the two; we
  // merge both so the result is correct regardless.
  //
  // Convention: `inter` Nr that resolves to the name "Keine-Abteilung" is a
  // Linear marker for "this member explicitly has no abteilung" — we skip
  // those rather than create an "Keine-Abteilung" abteilung in the UI.
  if ((input.interes?.length ?? 0) > 0 && adrNrToMemberId.size > 0) {
    const interNrToName = new Map<number, string>();
    for (const raw of input.inter ?? []) {
      const m = mapInterRow(raw);
      if (!m) continue;
      interNrToName.set(m.nr, m.name);
    }

    for (const raw of input.interes ?? []) {
      try {
        const mapped = mapInteresRow(raw);
        if (!mapped) continue;
        const memberId = adrNrToMemberId.get(mapped.adrNr);
        if (!memberId) continue;
        const name = interNrToName.get(mapped.interesNr);
        if (!name) continue;
        // Linear's "no abteilung" sentinel.
        if (/keine[-\s]?abteilung/i.test(name)) continue;

        let aid = abteilungByName.get(name.toLowerCase());
        if (!aid) {
          const [created] = await db
            .insert(abteilungenTable)
            .values({ name, slug: slugify(name) })
            .onConflictDoNothing({ target: abteilungenTable.name })
            .returning({ id: abteilungenTable.id });
          if (created) aid = created.id;
          else {
            const [existing2] = await db
              .select({ id: abteilungenTable.id })
              .from(abteilungenTable)
              .where(eq(abteilungenTable.name, name))
              .limit(1);
            aid = existing2?.id;
          }
          if (aid) abteilungByName.set(name.toLowerCase(), aid);
        }
        if (!aid) continue;

        const dateStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
        const eintrittsdatum = dateStr(mapped.eintritt) ?? "1900-01-01";
        await db
          .insert(memberAbteilungenTable)
          .values({
            memberId,
            abteilungId: aid,
            eintrittsdatum,
            austrittsdatum: dateStr(mapped.austritt),
          })
          .onConflictDoNothing();
      } catch (e) {
        errors.push({ table: "interes", message: (e as Error).message });
      }
    }
  }

  // Count abteilung links once (post-insert).
  const [abtCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(memberAbteilungenTable);
  const abteilungenLinked = abtCount?.c ?? 0;

  const membersWritten = membersCreated + membersUpdated;

  await db
    .update(importBatchesTable)
    .set({
      membersWritten,
      contractsWritten,
      feeTypesWritten,
      sepaWritten,
      relationshipsWritten,
      errors: errors.length > 0 ? errors : null,
      finishedAt: new Date(),
    })
    .where(eq(importBatchesTable.id, batch.id));

  await invalidateMemberCaches();

  return {
    batchId: batch.id,
    membersWritten,
    membersCreated,
    membersUpdated,
    feeTypesWritten,
    contractsWritten,
    sepaWritten,
    relationshipsWritten,
    abteilungenLinked,
    errors,
  };
}
