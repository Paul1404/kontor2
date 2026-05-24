import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import type { Contract } from "~/server/db/schema/contracts";
import { contractsTable } from "~/server/db/schema/contracts";
import { feeRunItemsTable } from "~/server/db/schema/fee-runs";
import type { Member } from "~/server/db/schema/members";
import { membersTable } from "~/server/db/schema/members";
import type { SepaMandate } from "~/server/db/schema/sepa";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { selectMandate, sequenceTypeFor } from "~/server/sepa/select-mandate";

export type MandateSummary = {
  id: string;
  mandatsNr: string;
  status: string | null;
  unterschriftDatum: string | null;
  ersteVerwendung: string | null;
  letzteVerwendung: string | null;
};

export type PreviewCandidate = {
  memberId: string;
  memberName: string;
  contractId: string;
  vertragNr: string;
  art: number;
  artName: string | null;
  baseAmount: string; // contracts.betrag, decimal string
  aufnahmegeb: string; // 0 if not added
  amount: string; // baseAmount + aufnahmegeb
  includesAufnahmegebuhr: boolean;
  mandateOptions: MandateSummary[];
  chosenMandateId: string;
  sequenceType: "FRST" | "RCUR" | "OOFF" | "FNAL";
  conflict: boolean;
  warnings: string[];
  debtorName: string;
  debtorIbanLast4: string;
  debtorBic: string | null;
};

export type PreviewExclusion = {
  memberId: string;
  memberName: string;
  contractId: string;
  vertragNr: string;
  artName: string | null;
  reason: string;
};

export type Preview = {
  candidates: PreviewCandidate[];
  excluded: PreviewExclusion[];
  conflicts: { memberId: string; contractId: string; options: MandateSummary[] }[];
  totals: {
    grandTotal: string;
    count: number;
    byCategory: Record<string, { count: number; amount: string }>;
  };
  issues: { level: "error" | "warning"; message: string }[];
};

export type PreviewParams = {
  billingYear: number;
  falligkeitsdatum: Date;
  mandateOverrides?: Record<string, string>; // contractId -> mandateId
};

/**
 * Pure-ish builder: queries are encapsulated, but no writes happen here.
 * Called from both `feeRuns.preview` and `feeRuns.commit` so the commit
 * snapshot exactly mirrors what the user saw.
 */
export async function buildFeeRunPreview(db: DB, params: PreviewParams): Promise<Preview> {
  const { billingYear, falligkeitsdatum, mandateOverrides = {} } = params;
  const yearStart = new Date(Date.UTC(billingYear, 0, 1));
  const yearEnd = new Date(Date.UTC(billingYear, 11, 31, 23, 59, 59));

  const candidates: PreviewCandidate[] = [];
  const excluded: PreviewExclusion[] = [];
  const conflicts: Preview["conflicts"] = [];
  const issues: Preview["issues"] = [];

  // Load all active contracts for the year. JOIN to members so we can
  // filter out soft-deleted members at the DB layer.
  const rows = await db
    .select({
      contract: contractsTable,
      member: membersTable,
    })
    .from(contractsTable)
    .innerJoin(membersTable, eq(contractsTable.memberId, membersTable.id))
    .where(
      and(
        sql`coalesce(${membersTable.geloscht}, false) = false`,
        sql`(${contractsTable.vertragBegin} is null or ${contractsTable.vertragBegin} <= ${yearEnd})`,
        sql`(${contractsTable.vertragEnde} is null or ${contractsTable.vertragEnde} > ${yearStart})`,
      ),
    );

  if (rows.length === 0) {
    return emptyResult();
  }

  // Bulk-load mandates for all candidate members.
  const memberIds = Array.from(new Set(rows.map((r) => r.member.id)));
  const mandates =
    memberIds.length === 0
      ? []
      : await db
          .select()
          .from(sepaMandatesTable)
          .where(inArray(sepaMandatesTable.memberId, memberIds));
  const mandatesByMember = new Map<string, SepaMandate[]>();
  for (const m of mandates) {
    const list = mandatesByMember.get(m.memberId) ?? [];
    list.push(m);
    mandatesByMember.set(m.memberId, list);
  }

  // Bulk-load Aufnahmegebühr-history flags: which contracts have already
  // been charged the enrollment fee in a prior, non-cancelled run?
  const contractIds = rows.map((r) => r.contract.id);
  const aufnGesehen = new Set<string>();
  if (contractIds.length > 0) {
    const seen = await db
      .select({ contractId: feeRunItemsTable.contractId })
      .from(feeRunItemsTable)
      .where(
        and(
          inArray(feeRunItemsTable.contractId, contractIds),
          eq(feeRunItemsTable.includesAufnahmegebuhr, true),
        ),
      );
    for (const s of seen) aufnGesehen.add(s.contractId);
  }

  for (const { contract, member } of rows) {
    const memberName = displayName(member);
    const baseAmount = parseAmount(contract.betrag);

    if (baseAmount === 0) {
      excluded.push({
        memberId: member.id,
        memberName,
        contractId: contract.id,
        vertragNr: contract.vertragNr,
        artName: contract.artName,
        reason: "Beitragsfrei (Betrag = 0)",
      });
      continue;
    }

    if (contract.lastschrift && contract.lastschrift.toUpperCase() !== "J") {
      excluded.push({
        memberId: member.id,
        memberName,
        contractId: contract.id,
        vertragNr: contract.vertragNr,
        artName: contract.artName,
        reason: "Lastschrift nicht aktiv",
      });
      continue;
    }

    const memberMandates = mandatesByMember.get(member.id) ?? [];
    const sel = selectMandate(memberMandates, mandateOverrides[contract.id]);
    if (!sel.chosen) {
      excluded.push({
        memberId: member.id,
        memberName,
        contractId: contract.id,
        vertragNr: contract.vertragNr,
        artName: contract.artName,
        reason: "Kein aktives SEPA-Mandat",
      });
      continue;
    }

    // `iban1` is transparently decrypted by the `encryptedText` Drizzle
    // custom type — it arrives as a plain string already.
    const iban = member.iban1;
    if (!iban) {
      excluded.push({
        memberId: member.id,
        memberName,
        contractId: contract.id,
        vertragNr: contract.vertragNr,
        artName: contract.artName,
        reason: "Keine IBAN hinterlegt",
      });
      continue;
    }

    const aufnRaw = parseAmount(contract.aufnahmegeb);
    const includeAufn = aufnRaw > 0 && !aufnGesehen.has(contract.id);
    const totalCents = toCents(baseAmount) + (includeAufn ? toCents(aufnRaw) : 0n);

    const warnings: string[] = [];
    if (sel.conflict) {
      warnings.push("Mehrere aktive Mandate -- bitte prüfen");
      conflicts.push({
        memberId: member.id,
        contractId: contract.id,
        options: sel.options.map(mandateSummary),
      });
    }

    const sequenceType = sequenceTypeFor(sel.chosen);
    candidates.push({
      memberId: member.id,
      memberName,
      contractId: contract.id,
      vertragNr: contract.vertragNr,
      art: contract.art,
      artName: contract.artName,
      baseAmount: centsToAmount(toCents(baseAmount)),
      aufnahmegeb: includeAufn ? centsToAmount(toCents(aufnRaw)) : "0.00",
      amount: centsToAmount(totalCents),
      includesAufnahmegebuhr: includeAufn,
      mandateOptions: sel.options.map(mandateSummary),
      chosenMandateId: sel.chosen.id,
      sequenceType,
      conflict: sel.conflict,
      warnings,
      debtorName: debtorNameFor(member, contract),
      debtorIbanLast4: member.iban1Last4 ?? iban.slice(-4),
      debtorBic: member.bic1 ?? null,
    });
  }

  // Aggregate.
  let grandCents = 0n;
  const byCategory: Record<string, { count: number; cents: bigint }> = {};
  for (const c of candidates) {
    const cents = amountStrToCents(c.amount);
    grandCents += cents;
    const key = c.artName ?? `Art ${c.art}`;
    const cat = byCategory[key] ?? { count: 0, cents: 0n };
    cat.count += 1;
    cat.cents += cents;
    byCategory[key] = cat;
  }

  if (candidates.length === 0) {
    issues.push({ level: "warning", message: "Keine berechtigten Mitglieder gefunden." });
  }

  return {
    candidates,
    excluded,
    conflicts,
    totals: {
      grandTotal: centsToAmount(grandCents),
      count: candidates.length,
      byCategory: Object.fromEntries(
        Object.entries(byCategory).map(([k, v]) => [
          k,
          { count: v.count, amount: centsToAmount(v.cents) },
        ]),
      ),
    },
    issues,
  };
}

function emptyResult(): Preview {
  return {
    candidates: [],
    excluded: [],
    conflicts: [],
    totals: { grandTotal: "0.00", count: 0, byCategory: {} },
    issues: [{ level: "warning", message: "Keine Verträge im Abrechnungsjahr gefunden." }],
  };
}

function mandateSummary(m: SepaMandate): MandateSummary {
  return {
    id: m.id,
    mandatsNr: m.mandatsNr,
    status: m.status,
    unterschriftDatum: m.unterschriftDatum?.toISOString().slice(0, 10) ?? null,
    ersteVerwendung: m.ersteVerwendung?.toISOString().slice(0, 10) ?? null,
    letzteVerwendung: m.letzteVerwendung?.toISOString().slice(0, 10) ?? null,
  };
}

function displayName(m: Member): string {
  const parts = [m.vorname, m.nachname].filter(Boolean).join(" ").trim();
  return parts || m.kurzname || m.firma1 || `AdrNr ${m.adrNr}`;
}

function debtorNameFor(m: Member, c: Contract): string {
  // Honour abwKontoInh override on the contract -- e.g. when the parent
  // pays for a juvenile member.
  if (c.abwKontoInh && c.abwKontoInh.trim().length > 0) return c.abwKontoInh.trim();
  return displayName(m);
}

function parseAmount(s: string | null | undefined): number {
  if (s == null || s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function toCents(n: number): bigint {
  return BigInt(Math.round(n * 100));
}

function amountStrToCents(s: string): bigint {
  const [intp = "0", fracp = ""] = s.split(".");
  const frac = (fracp + "00").slice(0, 2);
  return BigInt(intp) * 100n + BigInt(frac || "0");
}

function centsToAmount(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, "0")}`;
}
