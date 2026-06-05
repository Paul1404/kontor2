import { eq, inArray, or, sql } from "drizzle-orm";
import { appendAudit, diff } from "~/server/audit/log";
import type { DB } from "~/server/db/client";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { contractsTable } from "~/server/db/schema/contracts";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { feeTypePriceHistoryTable } from "~/server/db/schema/fee-type-history";
import { feeTypesTable } from "~/server/db/schema/fee-types";
import { importBatchesTable } from "~/server/db/schema/import-batches";
import { legacySepaRunItemsTable, legacySepaRunsTable } from "~/server/db/schema/legacy-sepa";
import { linearFederationsTable, linearSportTypesTable } from "~/server/db/schema/linear-lookups";
import { memberSourceRecordsTable } from "~/server/db/schema/member-source-records";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { slugify, splitAbteilung } from "~/server/importer/abteilung-splitter";
import { aggregateMgsolln, statusFor } from "~/server/importer/aggregate-mgsolln";
import { batchInsert } from "~/server/importer/batch";
import {
  type LinearRow,
  mapContractRow,
  mapFachverbandRow,
  mapFeeTypeRow,
  mapInteresRow,
  mapInterRow,
  mapLastProtRow,
  mapLastProtSRow,
  mapMemberRow,
  mapMgartDatRow,
  mapSepaRow,
  mapSollStellungRow,
  mapSportartRow,
  mapVerknRow,
} from "~/server/importer/linear-mapper";
import { cleanMemberColumns, translateLinearMember } from "~/server/importer/translate-member";
import { invalidateMemberCaches } from "~/server/search/cache";

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
  /** Linear `mgsolln` — historical Sollstellungen (per (AdrNr, VertragNr, Jahr, Zeitraum)). */
  mgsolln?: LinearRow[];
  /** Linear `mgartdat` — per-month Beitragsart price history. */
  mgartdat?: LinearRow[];
  /** Linear `sportarten` — DOSB/BLSV sport-type catalogue. */
  sportarten?: LinearRow[];
  /** Linear `fachverbaende` — sport federation catalogue. */
  fachverbaende?: LinearRow[];
  /** Linear `lastprot` — active SEPA debit run history (with pain.008 XML). */
  lastprot?: LinearRow[];
  /** Linear `lastproth` — purged SEPA debit run journal. */
  lastproth?: LinearRow[];
  /** Linear `lastprots` — per-debit links from active SEPA runs to Sollstellungen. */
  lastprots?: LinearRow[];
  /** Linear `lastprotsh` — per-debit links from purged SEPA runs. */
  lastprotsh?: LinearRow[];
  requestId?: string | null;
  /**
   * When true, member→Abteilung links are wiped for the AdrNrs in this batch
   * before re-creating them from the dump. This makes Linear the source of
   * truth for the assignment, at the cost of losing any links added manually
   * in the UI after the previous import.
   */
  forceOverwriteAbteilungLinks?: boolean;
  /**
   * Optional progress sink. Called as phases advance with the running count of
   * input rows consumed. Kept Redis-agnostic so the pipeline stays pure and
   * testable; the caller wires it to wherever progress should surface.
   */
  onProgress?: (p: { phase: string; processed: number; total: number }) => void;
  /** Rows already accounted for before this ingest (e.g. pre-import snapshots),
   *  so a multi-stage import can report one monotonic bar. */
  progressBase?: number;
  /** Grand total to report against. Defaults to this ingest's own row sum. */
  progressTotal?: number;
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
  /** Aggregated `(member, contract, year)` rows inserted from Linear `mgsolln`. */
  sollStellungenImported: number;
  feeTypeHistoryImported: number;
  sportTypesImported: number;
  federationsImported: number;
  legacySepaRunsImported: number;
  legacySepaItemsImported: number;
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

  // Progress scaffolding. `processed` counts input rows consumed so the UI can
  // render one monotonic 0..total bar across every phase. `len()` is the per-
  // phase input size; after each phase we snap `processed` to the phase end so
  // rows the mapper dropped don't leave the bar short.
  const len = (rows?: LinearRow[]): number => rows?.length ?? 0;
  const localTotal =
    len(input.feeTypes) +
    len(input.members) +
    len(input.contracts) +
    len(input.sepa) +
    len(input.relationships) +
    len(input.interes) +
    len(input.sportarten) +
    len(input.fachverbaende) +
    len(input.mgartdat) +
    len(input.mgsolln) +
    len(input.lastprot) +
    len(input.lastproth) +
    len(input.lastprots) +
    len(input.lastprotsh);
  const grandTotal = input.progressTotal ?? localTotal;
  let processed = input.progressBase ?? 0;
  const report = (phase: string): void =>
    input.onProgress?.({ phase, processed, total: grandTotal });

  // 1. Fee types: upsert by `art`.
  const feeTypeValues: Record<string, unknown>[] = [];
  for (const raw of input.feeTypes ?? []) {
    try {
      const row = mapFeeTypeRow(raw);
      if (!row) continue;
      feeTypeValues.push({ ...row, importBatchId: batch.id, updatedAt: new Date() });
    } catch (e) {
      errors.push({ table: "mgart", message: (e as Error).message });
    }
  }
  const feeTypeBase = processed;
  const feeTypesWritten = await batchInsert(db, feeTypesTable, feeTypeValues, {
    conflict: { target: feeTypesTable.art },
    onError: (_r, e) => errors.push({ table: "mgart", message: e.message }),
    onProgress: (p) => {
      processed = feeTypeBase + p;
      report("Beitragsarten");
    },
  });
  processed = feeTypeBase + len(input.feeTypes);
  report("Beitragsarten");

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

  // Preload every existing member this dump touches in one query, keyed by
  // adrNr. Replaces a per-row SELECT (the biggest source of round-trips in
  // this phase) with a single read; the upsert/audit still runs per row
  // because the create/update decision and field-level diff are row-specific.
  const existingByAdrNr = new Map<number, typeof membersTable.$inferSelect>();
  {
    const incoming = (input.members ?? [])
      .map((r) => Number(r.AdrNr ?? r.adr_nr ?? r.adrNr))
      .filter((n) => Number.isFinite(n)) as number[];
    if (incoming.length > 0) {
      for (const m of await db
        .select()
        .from(membersTable)
        .where(inArray(membersTable.adrNr, incoming))) {
        existingByAdrNr.set(m.adrNr, m);
      }
    }
  }

  // Member→Abteilung links are collected here and flushed as one batch after
  // the loop (deduped, since the same pair can arrive from both adresse.Abteilung
  // and the interes table). `pushLink` records one resolved link.
  const memberLinkValues: Record<string, unknown>[] = [];
  const seenLinks = new Set<string>();
  const pushLink = (
    memberId: string,
    abteilungId: string,
    row: {
      eintrittsdatum: string;
      austrittsdatum: string | null;
    },
  ): void => {
    const key = `${memberId}|${abteilungId}`;
    if (seenLinks.has(key)) return;
    seenLinks.add(key);
    memberLinkValues.push({ memberId, abteilungId, ...row });
  };

  const membersBase = processed;
  let memberRowIndex = 0;
  for (const raw of input.members ?? []) {
    try {
      const mapped = mapMemberRow(raw);
      if (!mapped) continue;
      // Dual-write: keep every legacy column exactly as before and add the
      // clean, normalized columns from the same source row. The translator is
      // the single anti-corruption boundary (also used by the one-time
      // backfill), so the live import and the backfill cannot diverge. Nothing
      // reads the clean columns yet; legacy columns stay authoritative until
      // consumers are cut over.
      const clean = translateLinearMember(raw);
      const row = clean ? { ...mapped, ...cleanMemberColumns(clean) } : mapped;
      const adrNr = row.adrNr as number;

      const existing = existingByAdrNr.get(adrNr);

      // Soft-delete unification: fold the legacy `geloscht` flag into the app's
      // single `deletedAt`. One-directional and idempotent -- set it once for a
      // legacy-deleted member, never clobber an existing delete (legacy or app),
      // and never auto-restore. Consumers read `deletedAt` alone.
      if (clean?.isDeleted && !existing?.deletedAt) {
        (row as Record<string, unknown>).deletedAt = new Date();
      }

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

      // Provenance: store the verbatim Linear row as jsonb so the working
      // schema can later drop legacy columns without losing data (audit, DSGVO
      // Auskunft, re-derivation). One current record per member, refreshed in
      // place on every import; change history lives in the audit log.
      await db
        .insert(memberSourceRecordsTable)
        .values({
          memberId,
          adrNr,
          importBatchId: batch.id,
          sourceTable: "adresse",
          raw: raw as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: [memberSourceRecordsTable.memberId, memberSourceRecordsTable.sourceTable],
          set: {
            adrNr,
            importBatchId: batch.id,
            raw: raw as Record<string, unknown>,
            importedAt: new Date(),
          },
        });

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
        pushLink(memberId, aid, {
          eintrittsdatum: dateStr(eintritt) ?? "1900-01-01",
          austrittsdatum: dateStr(austritt),
        });
      }
    } catch (e) {
      errors.push({ table: "adresse", message: (e as Error).message });
    }
    if (++memberRowIndex % 25 === 0) {
      processed = membersBase + memberRowIndex;
      report("Mitglieder");
    }
  }
  processed = membersBase + len(input.members);
  report("Mitglieder");

  // Flush the Abteilungs-Mitgliedschaften gathered from adresse.Abteilung in
  // one batch (the interes table appends more below before they're all read
  // back for the summary count).
  await batchInsert(db, memberAbteilungenTable, memberLinkValues, {
    conflict: { updateKeys: [] },
    onError: (_r, e) => errors.push({ table: "adresse", message: e.message }),
  });
  memberLinkValues.length = 0;

  // 3. Contracts: replace all rows for AdrNrs that the dump touches.
  //
  //    The delete scope must cover the UNION of (members successfully
  //    mapped in step 2) AND (AdrNrs the contracts/sepa sections
  //    reference) — otherwise, if `mapMemberRow` returned null for a
  //    member that already exists in the DB, the new contracts in the
  //    dump get dropped AND the existing DB rows are never refreshed,
  //    leaving members desynchronized from Linear.
  const mappedAdrNrs = [...adrNrToMemberId.keys()];

  const collectAdrNrs = (rows: LinearRow[] | undefined): number[] => {
    if (!rows) return [];
    const out: number[] = [];
    for (const r of rows) {
      const adr = Number(r.AdrNr ?? r.adr_nr ?? r.adrNr);
      if (Number.isFinite(adr)) out.push(adr);
    }
    return out;
  };

  // Build a fallback adrNr → memberId map for AdrNrs referenced by the
  // child tables but missing from the in-memory map (e.g. when the
  // members section was skipped or partially failed). We hit the DB once
  // per ingest to look these up.
  const collectVerknAdrNrs = (rows: LinearRow[] | undefined): number[] => {
    if (!rows) return [];
    const out: number[] = [];
    for (const r of rows) {
      const from = Number(r.ADRNR ?? r.AdrNr ?? r.adr_nr);
      const to = Number(r.VERKN ?? r.Verkn);
      if (Number.isFinite(from)) out.push(from);
      if (Number.isFinite(to)) out.push(to);
    }
    return out;
  };
  const allReferencedAdrNrs = Array.from(
    new Set([
      ...mappedAdrNrs,
      ...collectAdrNrs(input.contracts),
      ...collectAdrNrs(input.sepa),
      ...collectVerknAdrNrs(input.relationships),
    ]),
  );
  if (allReferencedAdrNrs.length > 0) {
    const existing = await db
      .select({ id: membersTable.id, adrNr: membersTable.adrNr })
      .from(membersTable)
      .where(inArray(membersTable.adrNr, allReferencedAdrNrs));
    for (const row of existing) {
      if (!adrNrToMemberId.has(row.adrNr)) adrNrToMemberId.set(row.adrNr, row.id);
    }
  }

  const contractBase = processed;
  let contractsWritten = 0;
  if ((input.contracts?.length ?? 0) > 0 && allReferencedAdrNrs.length > 0) {
    await db.delete(contractsTable).where(inArray(contractsTable.adrNr, allReferencedAdrNrs));
    const contractValues: Record<string, unknown>[] = [];
    for (const raw of input.contracts ?? []) {
      try {
        const row = mapContractRow(raw);
        if (!row) continue;
        const memberId = adrNrToMemberId.get(row.adrNr as number);
        if (!memberId) continue;
        contractValues.push({ ...row, memberId, importBatchId: batch.id, updatedAt: new Date() });
      } catch (e) {
        errors.push({ table: "mgvert", message: (e as Error).message });
      }
    }
    contractsWritten = await batchInsert(db, contractsTable, contractValues, {
      onError: (_r, e) => errors.push({ table: "mgvert", message: e.message }),
      onProgress: (p) => {
        processed = contractBase + p;
        report("Verträge");
      },
    });
  }
  processed = contractBase + len(input.contracts);
  report("Verträge");

  // 4. SEPA mandates: same strategy as contracts.
  const sepaBase = processed;
  let sepaWritten = 0;
  if ((input.sepa?.length ?? 0) > 0 && allReferencedAdrNrs.length > 0) {
    await db.delete(sepaMandatesTable).where(inArray(sepaMandatesTable.adrNr, allReferencedAdrNrs));
    const sepaValues: Record<string, unknown>[] = [];
    for (const raw of input.sepa ?? []) {
      try {
        const row = mapSepaRow(raw);
        if (!row) continue;
        const memberId = adrNrToMemberId.get(row.adrNr as number);
        if (!memberId) continue;
        sepaValues.push({ ...row, memberId, importBatchId: batch.id, updatedAt: new Date() });
      } catch (e) {
        errors.push({ table: "adrsepa", message: (e as Error).message });
      }
    }
    sepaWritten = await batchInsert(db, sepaMandatesTable, sepaValues, {
      onError: (_r, e) => errors.push({ table: "adrsepa", message: e.message }),
      onProgress: (p) => {
        processed = sepaBase + p;
        report("SEPA-Mandate");
      },
    });
  }
  processed = sepaBase + len(input.sepa);
  report("SEPA-Mandate");

  // 5. Relationships (verkn): replace rows touching any imported AdrNr on
  // either side, then upsert. Linear keeps reciprocal pairs as separate
  // rows, so we preserve direction.
  const relBase = processed;
  let relationshipsWritten = 0;
  if ((input.relationships?.length ?? 0) > 0 && allReferencedAdrNrs.length > 0) {
    await db
      .delete(relationshipsTable)
      .where(
        or(
          inArray(relationshipsTable.fromAdrNr, allReferencedAdrNrs),
          inArray(relationshipsTable.toAdrNr, allReferencedAdrNrs),
        ),
      );
    // Dedupe on the (fromAdrNr, toAdrNr) conflict key so a single multi-row
    // upsert never tries to touch the same row twice (Postgres rejects that);
    // last occurrence wins, matching the per-row "last write" behaviour.
    const relByKey = new Map<string, Record<string, unknown>>();
    for (const raw of input.relationships ?? []) {
      try {
        const row = mapVerknRow(raw);
        if (!row) continue;
        const fromMemberId = adrNrToMemberId.get(row.fromAdrNr as number);
        if (!fromMemberId) continue;
        const toMemberId = adrNrToMemberId.get(row.toAdrNr as number) ?? null;
        relByKey.set(`${row.fromAdrNr}|${row.toAdrNr}`, {
          ...row,
          fromMemberId,
          toMemberId,
          importBatchId: batch.id,
          updatedAt: new Date(),
        });
      } catch (e) {
        errors.push({ table: "verkn", message: (e as Error).message });
      }
    }
    relationshipsWritten = await batchInsert(db, relationshipsTable, [...relByKey.values()], {
      conflict: { target: [relationshipsTable.fromAdrNr, relationshipsTable.toAdrNr] },
      onError: (_r, e) => errors.push({ table: "verkn", message: e.message }),
      onProgress: (p) => {
        processed = relBase + p;
        report("Beziehungen");
      },
    });
  }
  processed = relBase + len(input.relationships);
  report("Beziehungen");

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
        pushLink(memberId, aid, {
          eintrittsdatum: dateStr(mapped.eintritt) ?? "1900-01-01",
          austrittsdatum: dateStr(mapped.austritt),
        });
      } catch (e) {
        errors.push({ table: "interes", message: (e as Error).message });
      }
    }

    await batchInsert(db, memberAbteilungenTable, memberLinkValues, {
      conflict: { updateKeys: [] },
      onError: (_r, e) => errors.push({ table: "interes", message: e.message }),
    });
    memberLinkValues.length = 0;
  }
  processed += len(input.interes);
  report("Abteilungs-Zuordnungen");

  // 7. Sportarten + Fachverbaende lookups. Pure reference data; replace
  // wholesale per (kz, nummer, lfdNr). Both are static catalogues from
  // BLSV/DOSB so an admin re-importing should overwrite cleanly.
  const sportValues: Record<string, unknown>[] = [];
  for (const raw of input.sportarten ?? []) {
    try {
      const row = mapSportartRow(raw);
      if (row) sportValues.push(row as Record<string, unknown>);
    } catch (e) {
      errors.push({ table: "sportarten", message: (e as Error).message });
    }
  }
  const sportBase = processed;
  const sportTypesImported = await batchInsert(db, linearSportTypesTable, sportValues, {
    conflict: {
      target: [linearSportTypesTable.kz, linearSportTypesTable.nummer, linearSportTypesTable.lfdNr],
      updateKeys: ["sportart", "verbandNr"],
    },
    onError: (_r, e) => errors.push({ table: "sportarten", message: e.message }),
    onProgress: (p) => {
      processed = sportBase + p;
      report("Sportarten und Verbände");
    },
  });
  processed = sportBase + len(input.sportarten);
  report("Sportarten und Verbände");

  const federationValues: Record<string, unknown>[] = [];
  for (const raw of input.fachverbaende ?? []) {
    try {
      const row = mapFachverbandRow(raw);
      if (row) federationValues.push(row as Record<string, unknown>);
    } catch (e) {
      errors.push({ table: "fachverbaende", message: (e as Error).message });
    }
  }
  const fedBase = processed;
  const federationsImported = await batchInsert(db, linearFederationsTable, federationValues, {
    conflict: {
      target: [
        linearFederationsTable.kz,
        linearFederationsTable.nummer,
        linearFederationsTable.lfdNr,
      ],
      updateKeys: ["fachverband", "kn"],
    },
    onError: (_r, e) => errors.push({ table: "fachverbaende", message: e.message }),
    onProgress: (p) => {
      processed = fedBase + p;
      report("Sportarten und Verbände");
    },
  });
  processed = fedBase + len(input.fachverbaende);
  report("Sportarten und Verbände");

  // 8. Beitragsart price history. PK is (art, jahr, monat); upsert so a
  // re-import refreshes the table without piling up duplicates.
  const mgartByKey = new Map<string, Record<string, unknown>>();
  for (const raw of input.mgartdat ?? []) {
    try {
      const row = mapMgartDatRow(raw);
      if (!row) continue;
      // `datum` is a Postgres DATE column (string mode in Drizzle). The mapper
      // returns a JS Date; passing it straight through serialises via
      // toString() ("Fri Jan 01 2016 ...") which Postgres rejects as invalid
      // date syntax. Normalise to an ISO YYYY-MM-DD string first, same as the
      // soll_stellungen / abteilungen date columns.
      const datumRaw = (row as { datum?: Date | null }).datum;
      const datum = datumRaw ? datumRaw.toISOString().slice(0, 10) : null;
      // Dedupe on the (art, jahr, monat) PK so the multi-row upsert never
      // touches the same row twice; last occurrence wins.
      mgartByKey.set(`${row.art}|${row.jahr}|${row.monat}`, { ...row, datum });
    } catch (e) {
      errors.push({ table: "mgartdat", message: (e as Error).message });
    }
  }
  const mgartBase = processed;
  const feeTypeHistoryImported = await batchInsert(
    db,
    feeTypePriceHistoryTable,
    [...mgartByKey.values()],
    {
      conflict: {
        target: [
          feeTypePriceHistoryTable.art,
          feeTypePriceHistoryTable.jahr,
          feeTypePriceHistoryTable.monat,
        ],
        updateKeys: ["betrag", "prozent", "datum"],
      },
      onError: (_r, e) => errors.push({ table: "mgartdat", message: e.message }),
      onProgress: (p) => {
        processed = mgartBase + p;
        report("Beitragshistorie");
      },
    },
  );
  processed = mgartBase + len(input.mgartdat);
  report("Beitragshistorie");

  // 9. Historical Sollstellungen from `mgsolln`.
  //
  // Linear's PK is `(AdrNr, Jahr, VertragNr, Art, Zeitraum)` — same year /
  // contract can carry multiple "Zeitraum" rows. The app's
  // `soll_stellungen` is unique on `(contract_id, billing_year)`, so we
  // aggregate by summing `Betrag` / `Bezahlt` / `Offen` across all rows
  // sharing the natural key. The first row's GUID becomes the
  // representative `linear_guid` (also the join key into `lastprots`).
  //
  // We only import rows whose `(adrNr, vertragNr)` resolves to an existing
  // contract; the rest are reported in `errors` so an operator can decide
  // whether to backfill the contract or accept the loss.
  let sollStellungenImported = 0;
  if ((input.mgsolln?.length ?? 0) > 0) {
    // Pre-load the (adrNr, vertragNr) → contractId/memberId map.
    const contractLookup = new Map<string, { contractId: string; memberId: string }>();
    const incomingAdrNrs = Array.from(
      new Set((input.mgsolln ?? []).map((r) => Number(r.AdrNr)).filter((n) => Number.isFinite(n))),
    );
    if (incomingAdrNrs.length > 0) {
      const contracts = await db
        .select({
          id: contractsTable.id,
          memberId: contractsTable.memberId,
          adrNr: contractsTable.adrNr,
          vertragNr: contractsTable.vertragNr,
        })
        .from(contractsTable)
        .where(inArray(contractsTable.adrNr, incomingAdrNrs));
      for (const c of contracts) {
        contractLookup.set(`${c.adrNr}|${c.vertragNr}`, {
          contractId: c.id,
          memberId: c.memberId,
        });
      }
    }

    // Map raw rows → typed Sollstellungen; drop malformed rows but keep
    // the count consistent.
    const mapped: ReturnType<typeof mapSollStellungRow>[] = [];
    for (const raw of input.mgsolln ?? []) {
      try {
        const m = mapSollStellungRow(raw);
        if (m) mapped.push(m);
      } catch (e) {
        errors.push({ table: "mgsolln", message: (e as Error).message });
      }
    }

    const { aggregated, missing } = aggregateMgsolln(
      mapped.filter((m): m is NonNullable<typeof m> => m !== null),
      (adrNr, vertragNr) => contractLookup.get(`${adrNr}|${vertragNr}`) ?? null,
    );

    if (missing.length > 0) {
      // Roll up unresolved (adrNr, vertragNr) pairs into a single error
      // entry — surfacing thousands of identical messages would drown
      // legitimate errors.
      const sample = missing.slice(0, 10).map((m) => `${m.adrNr}/${m.vertragNr}`);
      errors.push({
        table: "mgsolln",
        message: `${missing.length} Zeile(n) ohne passenden Vertrag übersprungen. Beispiele: ${sample.join(", ")}`,
      });
    }

    const sollValues: Record<string, unknown>[] = [];
    for (const v of aggregated) {
      const status = statusFor(v.openAmount);
      const falligkeit = v.falligkeitsdatum
        ? v.falligkeitsdatum.toISOString().slice(0, 10)
        : `${v.billingYear}-01-01`;
      sollValues.push({
        memberId: v.memberId,
        contractId: v.contractId,
        billingYear: v.billingYear,
        falligkeitsdatum: falligkeit,
        amount: v.amount,
        paidAmount: v.paidAmount,
        openAmount: v.openAmount,
        mahnstufe: v.mahnstufe,
        status,
        source: "linear_import",
        linearGuid: v.linearGuid,
        notes: v.rowCount > 1 ? `Aggregat aus ${v.rowCount} Linear-Zeiträumen (mgsolln)` : null,
        updatedAt: new Date(),
      });
    }
    sollStellungenImported = await batchInsert(db, sollStellungenTable, sollValues, {
      conflict: {
        target: [sollStellungenTable.contractId, sollStellungenTable.billingYear],
        updateKeys: [
          "amount",
          "paidAmount",
          "openAmount",
          "mahnstufe",
          "status",
          "source",
          "linearGuid",
          "falligkeitsdatum",
          "updatedAt",
        ],
      },
      onError: (_r, e) => errors.push({ table: "mgsolln", message: e.message }),
      onProgress: () => report("Sollstellungen"),
    });
  }
  processed += len(input.mgsolln);
  report("Sollstellungen");

  // 10. Legacy SEPA runs from `lastprot` (active) and `lastproth` (purged
  // journal). Upsert by `id` so re-imports refresh the row in place; the
  // archived flag distinguishes the two sources.
  let legacySepaRunsImported = 0;
  for (const [archivedFlag, rows] of [
    [false, input.lastprot],
    [true, input.lastproth],
  ] as const) {
    for (const raw of rows ?? []) {
      try {
        const row = mapLastProtRow(raw, archivedFlag);
        if (!row) continue;
        await db
          .insert(legacySepaRunsTable)
          .values(row as never)
          .onConflictDoUpdate({
            target: legacySepaRunsTable.id,
            set: {
              datum: (row as { datum?: Date }).datum,
              falligkeitsdatum: (row as { falligkeitsdatum?: Date | null }).falligkeitsdatum,
              benutzer: (row as { benutzer?: string }).benutzer,
              guid: (row as { guid?: string }).guid,
              xmlName: (row as { xmlName?: string }).xmlName,
              xmlData: (row as { xmlData?: string | null }).xmlData,
              archived: archivedFlag ? "true" : "false",
              importedAt: new Date(),
            } as never,
          });
        legacySepaRunsImported += 1;
      } catch (e) {
        errors.push({
          table: archivedFlag ? "lastproth" : "lastprot",
          message: (e as Error).message,
        });
      }
    }
  }
  processed += len(input.lastprot) + len(input.lastproth);
  report("Alt-SEPA-Läufe");

  // 11. Legacy SEPA run items (`lastprots` / `lastprotsh`). The (sepaGuid,
  // sollGuid) pair is the natural key.
  let legacySepaItemsImported = 0;
  for (const [archivedFlag, rows] of [
    [false, input.lastprots],
    [true, input.lastprotsh],
  ] as const) {
    for (const raw of rows ?? []) {
      try {
        const row = mapLastProtSRow(raw, archivedFlag);
        if (!row) continue;
        await db
          .insert(legacySepaRunItemsTable)
          .values(row as never)
          .onConflictDoUpdate({
            target: [legacySepaRunItemsTable.sepaGuid, legacySepaRunItemsTable.sollGuid],
            set: {
              betrag: (row as { betrag?: string | null }).betrag,
              offen: (row as { offen?: string | null }).offen,
              ruckLastGuid: (row as { ruckLastGuid?: string | null }).ruckLastGuid,
              archived: archivedFlag ? "true" : "false",
              importedAt: new Date(),
            } as never,
          });
        legacySepaItemsImported += 1;
      } catch (e) {
        errors.push({
          table: archivedFlag ? "lastprotsh" : "lastprots",
          message: (e as Error).message,
        });
      }
    }
  }
  processed += len(input.lastprots) + len(input.lastprotsh);
  report("Abschluss");

  // Count abteilung links for the members touched by THIS batch (not the
  // global table count, which keeps growing across imports and would
  // mislead operators reading the import summary).
  const batchMemberIds = [...adrNrToMemberId.values()];
  let abteilungenLinked = 0;
  if (batchMemberIds.length > 0) {
    const [abtCount] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(memberAbteilungenTable)
      .where(inArray(memberAbteilungenTable.memberId, batchMemberIds));
    abteilungenLinked = abtCount?.c ?? 0;
  }

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
    sollStellungenImported,
    feeTypeHistoryImported,
    sportTypesImported,
    federationsImported,
    legacySepaRunsImported,
    legacySepaItemsImported,
    errors,
  };
}
