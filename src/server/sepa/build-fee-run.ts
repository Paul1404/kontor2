import { and, eq, gt, inArray, isNull, lte, ne, or } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import { memberNotDeleted } from "~/server/db/member-filters";
import type { Contract } from "~/server/db/schema/contracts";
import { contractsTable } from "~/server/db/schema/contracts";
import { feeRunItemsTable, feeRunsTable, sollStellungenTable } from "~/server/db/schema/fee-runs";
import type { Member } from "~/server/db/schema/members";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import type { SepaMandate } from "~/server/db/schema/sepa";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { isMinorAt } from "~/server/domain/member";
import { resolveZahler, type ZahlerQuelle } from "~/server/domain/zahler";
import { selectMandate, sequenceTypeFor } from "~/server/sepa/select-mandate";
import { loadZahlerContext } from "~/server/sepa/zahler-context";

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
  amount: string; // (baseAmount * prorationFactor) + aufnahmegeb
  includesAufnahmegebuhr: boolean;
  prorationFactor: number; // 1 = full year (no proration applied)
  prorationLabel: string | null; // e.g. "9/12 Monate"; null when full year
  mandateOptions: MandateSummary[];
  chosenMandateId: string;
  sequenceType: "FRST" | "RCUR" | "OOFF" | "FNAL";
  conflict: boolean;
  warnings: string[];
  debtorName: string;
  debtorIbanLast4: string;
  debtorBic: string | null;
  /** Wessen Konto belastet wird: das Mitglied selbst oder ein Zahler. */
  zahlerMemberId: string;
  zahlerQuelle: ZahlerQuelle;
};

export type PreviewExclusion = {
  memberId: string;
  memberName: string;
  contractId: string;
  vertragNr: string;
  artName: string | null;
  reason: string;
};

/**
 * Ein Rechnungszahler: zahlt nicht per Lastschrift (`is_direct_debit = false`),
 * bekommt aber denselben (anteiligen) Beitrag. Statt einer pain.008-Zeile
 * entsteht beim Commit eine offene Sollstellung, die per Rechnung beglichen
 * wird und sofort in Offenen Posten und im Mahnwesen auftaucht.
 */
export type PreviewInvoice = {
  memberId: string;
  memberName: string;
  contractId: string;
  vertragNr: string;
  art: number;
  artName: string | null;
  baseAmount: string;
  aufnahmegeb: string;
  amount: string;
  includesAufnahmegebuhr: boolean;
  prorationFactor: number;
  prorationLabel: string | null;
  /** Wer die Rechnung bekommt: das Mitglied selbst oder ein Zahler. */
  zahlerMemberId: string;
};

export type Preview = {
  candidates: PreviewCandidate[];
  excluded: PreviewExclusion[];
  invoices: PreviewInvoice[];
  conflicts: { memberId: string; contractId: string; options: MandateSummary[] }[];
  totals: {
    grandTotal: string;
    count: number;
    byCategory: Record<string, { count: number; amount: string }>;
    invoiceTotal: string;
    invoiceCount: number;
  };
  issues: { level: "error" | "warning"; message: string }[];
};

/**
 * Member-level reasons the Beitragslauf skips a member, independent of the
 * contract, mandate, or amount. Checked in priority order: an explicit fee
 * exemption first, then a paused (ruhend) membership, then a SEPA direct-debit
 * hold. Returns the exclusion label, or null when none apply. Kept pure so the
 * cascade rules are unit-testable without a database.
 */
export function memberFeeBlockReason(member: {
  beitragsbefreit?: boolean | null;
  ruhend?: boolean | null;
  directDebitBlocked?: boolean | null;
}): string | null {
  if (member.beitragsbefreit) return "Beitragsbefreit";
  if (member.ruhend) return "Ruhend";
  if (member.directDebitBlocked) return "Einzug ausgesetzt";
  return null;
}

export type PreviewParams = {
  billingYear: number;
  falligkeitsdatum: Date;
  mandateOverrides?: Record<string, string>; // contractId -> mandateId
  /**
   * Restrict the run to these billed member ids. Used for a targeted
   * re-collection (e.g. failed direct debits + members the engine missed),
   * so the file carries exactly the chosen people and nothing else. Empty or
   * omitted = the normal club-wide run.
   */
  memberIds?: string[];
};

/**
 * Pure-ish builder: queries are encapsulated, but no writes happen here.
 * Called from both `feeRuns.preview` and `feeRuns.commit` so the commit
 * snapshot exactly mirrors what the user saw.
 */
export async function buildFeeRunPreview(db: DB, params: PreviewParams): Promise<Preview> {
  const { billingYear, mandateOverrides = {} } = params;
  const memberIdFilter = params.memberIds && params.memberIds.length > 0 ? params.memberIds : null;
  const yearStart = new Date(Date.UTC(billingYear, 0, 1));
  const yearEnd = new Date(Date.UTC(billingYear, 11, 31, 23, 59, 59));

  // Billing mode. Absent settings row → flat full-year (current behaviour).
  const [settings] = await db.select().from(organizationSettingsTable).limit(1);
  const modus: BeitragModus = settings?.beitragModus === "anteilig" ? "anteilig" : "voll";
  const einheit: AnteilEinheit = settings?.anteilEinheit === "tag" ? "tag" : "monat";

  const candidates: PreviewCandidate[] = [];
  const excluded: PreviewExclusion[] = [];
  const invoices: PreviewInvoice[] = [];
  const conflicts: Preview["conflicts"] = [];
  // A new mandate is FRST only on its first use in this run. If the same
  // mandate is hit by more than one contract (e.g. a family payer with two
  // contracts), every later use must be RCUR, or the pain.008 carries two FRST
  // for one mandate, which the bank rejects.
  const frstMandateIds = new Set<string>();
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
        // Exclude soft-deleted members. The legacy Linear `geloscht` flag is
        // folded into the app's single `deletedAt`.
        memberNotDeleted(),
        // Targeted re-collection: restrict to the chosen billed members.
        memberIdFilter ? inArray(membersTable.id, memberIdFilter) : undefined,
        // Use Drizzle's typed operators (not raw `sql`) so the timestamp
        // columns' encoder maps the JS Date to the format postgres-js expects.
        // A raw Date interpolated into `sql` reaches the driver unconverted and
        // throws ("must be of type string ... Received an instance of Date").
        or(isNull(contractsTable.vertragBegin), lte(contractsTable.vertragBegin, yearEnd)),
        or(isNull(contractsTable.vertragEnde), gt(contractsTable.vertragEnde, yearStart)),
      ),
    );

  if (rows.length === 0) {
    return emptyResult();
  }

  // Zahler-Aufloesung PRO VERTRAG: expliziter Vertrags-Zahler -> Familien-Zahler
  // (aktives Kind) -> Vertreter (Minderjaehrige) -> das Mitglied selbst (siehe
  // resolveZahler). Pro Vertrag, weil ein Mitglied mehrere Vertraege mit
  // unterschiedlichen Zahlern haben kann.
  const memberIds = Array.from(new Set(rows.map((r) => r.member.id)));
  const zahlerCtx = await loadZahlerContext(db, memberIds);
  const now = new Date();
  const zahlerByContract = new Map<string, ReturnType<typeof resolveZahler>>();
  for (const { contract, member } of rows) {
    zahlerByContract.set(
      contract.id,
      resolveZahler({
        memberId: member.id,
        explicitZahlerId: contract.zahlerMemberId ?? null,
        familieZahlerId: zahlerCtx.familieZahlerByMember.get(member.id) ?? null,
        vertreterId: zahlerCtx.vertreterByMember.get(member.id) ?? null,
        minderjaehrig: isMinorAt(member.geburtsdatum, now),
      }),
    );
  }

  // Zahler, die nicht selbst im Vertragsbestand stehen (z. B. Kontakte),
  // muessen fuer IBAN/Name nachgeladen werden.
  const zahlerIds = Array.from(new Set([...zahlerByContract.values()].map((z) => z.zahlerId)));
  const knownMembers = new Map(rows.map((r) => [r.member.id, r.member]));
  const missingZahlerIds = zahlerIds.filter((id) => !knownMembers.has(id));
  if (missingZahlerIds.length > 0) {
    const extra = await db
      .select()
      .from(membersTable)
      .where(inArray(membersTable.id, missingZahlerIds));
    for (const m of extra) knownMembers.set(m.id, m);
  }

  // Bulk-load mandates for all payers (the payer's mandate authorizes the
  // debit, not the billed member's).
  const mandates =
    zahlerIds.length === 0
      ? []
      : await db
          .select()
          .from(sepaMandatesTable)
          .where(inArray(sepaMandatesTable.memberId, zahlerIds));
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
      .innerJoin(feeRunsTable, eq(feeRunsTable.id, feeRunItemsTable.feeRunId))
      .where(
        and(
          inArray(feeRunItemsTable.contractId, contractIds),
          eq(feeRunItemsTable.includesAufnahmegebuhr, true),
          // A cancelled run's items still exist but never collected the fee, so
          // they must not count as "already charged" -- otherwise re-committing
          // after a cancel silently drops the Aufnahmegebühr.
          ne(feeRunsTable.status, "cancelled"),
        ),
      );
    for (const s of seen) aufnGesehen.add(s.contractId);
  }

  // Contracts that already carry a live (non-cancelled) Sollstellung for this
  // year. Re-running the Beitragslauf must not collect them again, so they are
  // excluded here -- a re-run only picks up contracts added or unblocked since
  // the last run, and is empty once everyone is covered. A cancelled posting
  // does not count, so re-billing after a Storno still works.
  const alreadyBilled = new Set<string>();
  if (contractIds.length > 0) {
    const billed = await db
      .select({ contractId: sollStellungenTable.contractId })
      .from(sollStellungenTable)
      .where(
        and(
          inArray(sollStellungenTable.contractId, contractIds),
          eq(sollStellungenTable.billingYear, billingYear),
          ne(sollStellungenTable.status, "cancelled"),
        ),
      );
    for (const b of billed) alreadyBilled.add(b.contractId);
  }

  for (const { contract, member } of rows) {
    const memberName = displayName(member);
    const baseAmount = parseAmount(contract.betrag);

    if (alreadyBilled.has(contract.id)) {
      excluded.push({
        memberId: member.id,
        memberName,
        contractId: contract.id,
        vertragNr: contract.vertragNr,
        artName: contract.artName,
        reason: "Bereits abgerechnet (Sollstellung vorhanden)",
      });
      continue;
    }

    const memberBlock = memberFeeBlockReason(member);
    if (memberBlock) {
      excluded.push({
        memberId: member.id,
        memberName,
        contractId: contract.id,
        vertragNr: contract.vertragNr,
        artName: contract.artName,
        reason: memberBlock,
      });
      continue;
    }

    if (baseAmount <= 0) {
      excluded.push({
        memberId: member.id,
        memberName,
        contractId: contract.id,
        vertragNr: contract.vertragNr,
        artName: contract.artName,
        // A SEPA direct debit must be a positive amount. A negative Beitrag
        // would otherwise produce an invalid (or reversing) debit line.
        reason:
          baseAmount === 0
            ? "Beitragsfrei (Betrag = 0)"
            : "Ungültiger Betrag (negativ), keine Lastschrift erzeugt",
      });
      continue;
    }

    if (!contract.isDirectDebit) {
      // Rechnungszahler: keine Lastschrift, aber derselbe (anteilige) Beitrag.
      // Beim Commit wird daraus eine offene Sollstellung (Rechnung).
      const aufnRawInv = parseAmount(contract.aufnahmegeb);
      const includeAufnInv = aufnRawInv > 0 && !aufnGesehen.has(contract.id);
      const prorationInv = computeProration({
        start: contract.vertragBegin ?? member.eintritt ?? null,
        end:
          contract.vertragEnde ??
          contract.gekuendZum ??
          member.austritt ??
          member.verstorbenAm ??
          null,
        year: billingYear,
        modus,
        einheit,
      });
      const baseCentsInv = applyFactor(toCents(baseAmount), prorationInv.factor);
      const totalCentsInv = baseCentsInv + (includeAufnInv ? toCents(aufnRawInv) : 0n);
      const zahlerInv = zahlerByContract.get(contract.id) ?? {
        zahlerId: member.id,
        quelle: "selbst" as const,
      };
      invoices.push({
        memberId: member.id,
        memberName,
        contractId: contract.id,
        vertragNr: contract.vertragNr,
        art: contract.art,
        artName: contract.artName,
        baseAmount: centsToAmount(baseCentsInv),
        aufnahmegeb: includeAufnInv ? centsToAmount(toCents(aufnRawInv)) : "0.00",
        amount: centsToAmount(totalCentsInv),
        includesAufnahmegebuhr: includeAufnInv,
        prorationFactor: prorationInv.factor,
        prorationLabel: prorationInv.label,
        zahlerMemberId: zahlerInv.zahlerId,
      });
      continue;
    }

    const zahler = zahlerByContract.get(contract.id) ?? {
      zahlerId: member.id,
      quelle: "selbst" as const,
    };
    const zahlerMember = knownMembers.get(zahler.zahlerId);
    const zahlerLabel =
      zahler.quelle === "selbst" || !zahlerMember ? null : `Zahler ${displayName(zahlerMember)}`;
    if (!zahlerMember || zahlerMember.deletedAt != null) {
      excluded.push({
        memberId: member.id,
        memberName,
        contractId: contract.id,
        vertragNr: contract.vertragNr,
        artName: contract.artName,
        reason: "Zahler nicht gefunden oder gelöscht",
      });
      continue;
    }
    if (zahler.quelle !== "selbst" && zahlerMember.directDebitBlocked) {
      excluded.push({
        memberId: member.id,
        memberName,
        contractId: contract.id,
        vertragNr: contract.vertragNr,
        artName: contract.artName,
        reason: `${zahlerLabel}: Einzug ausgesetzt`,
      });
      continue;
    }

    const zahlerMandates = mandatesByMember.get(zahler.zahlerId) ?? [];
    const sel = selectMandate(zahlerMandates, mandateOverrides[contract.id]);
    if (!sel.chosen) {
      excluded.push({
        memberId: member.id,
        memberName,
        contractId: contract.id,
        vertragNr: contract.vertragNr,
        artName: contract.artName,
        reason: zahlerLabel
          ? `${zahlerLabel}: kein aktives SEPA-Mandat`
          : "Kein aktives SEPA-Mandat",
      });
      continue;
    }

    // `iban1` is transparently decrypted by the `encryptedText` Drizzle
    // custom type — it arrives as a plain string already. The debit hits the
    // payer's account, so the payer's IBAN is required.
    const iban = zahlerMember.iban1;
    if (!iban) {
      excluded.push({
        memberId: member.id,
        memberName,
        contractId: contract.id,
        vertragNr: contract.vertragNr,
        artName: contract.artName,
        reason: zahlerLabel ? `${zahlerLabel}: keine IBAN hinterlegt` : "Keine IBAN hinterlegt",
      });
      continue;
    }

    const aufnRaw = parseAmount(contract.aufnahmegeb);
    const includeAufn = aufnRaw > 0 && !aufnGesehen.has(contract.id);

    // Anteilige Berechnung: nur der Jahresbeitrag wird gekürzt, die
    // Aufnahmegebühr bleibt unangetastet und wird weiterhin nur einmal erhoben.
    const proration = computeProration({
      start: contract.vertragBegin ?? member.eintritt ?? null,
      end:
        contract.vertragEnde ??
        contract.gekuendZum ??
        member.austritt ??
        member.verstorbenAm ??
        null,
      year: billingYear,
      modus,
      einheit,
    });
    const baseCents = applyFactor(toCents(baseAmount), proration.factor);
    const totalCents = baseCents + (includeAufn ? toCents(aufnRaw) : 0n);

    if (totalCents <= 0n) {
      // A positive fee can prorate down to 0,00 (e.g. a few days at a low rate).
      // A 0,00 SEPA direct-debit line is invalid, so skip it rather than emit it.
      excluded.push({
        memberId: member.id,
        memberName,
        contractId: contract.id,
        vertragNr: contract.vertragNr,
        artName: contract.artName,
        reason: "Anteiliger Betrag rundet auf 0,00 EUR, keine Lastschrift erzeugt",
      });
      continue;
    }

    const warnings: string[] = [];
    if (sel.conflict) {
      warnings.push("Mehrere aktive Mandate -- bitte prüfen");
      conflicts.push({
        memberId: member.id,
        contractId: contract.id,
        options: sel.options.map(mandateSummary),
      });
    }

    // FRST only on the mandate's first appearance in this run; demote later
    // uses of the same mandate to RCUR (see frstMandateIds above).
    let sequenceType = sequenceTypeFor(sel.chosen);
    if (sequenceType === "FRST") {
      if (frstMandateIds.has(sel.chosen.id)) sequenceType = "RCUR";
      else frstMandateIds.add(sel.chosen.id);
    }
    candidates.push({
      memberId: member.id,
      memberName,
      contractId: contract.id,
      vertragNr: contract.vertragNr,
      art: contract.art,
      artName: contract.artName,
      baseAmount: centsToAmount(baseCents),
      aufnahmegeb: includeAufn ? centsToAmount(toCents(aufnRaw)) : "0.00",
      amount: centsToAmount(totalCents),
      includesAufnahmegebuhr: includeAufn,
      prorationFactor: proration.factor,
      prorationLabel: proration.label,
      mandateOptions: sel.options.map(mandateSummary),
      chosenMandateId: sel.chosen.id,
      sequenceType,
      conflict: sel.conflict,
      warnings,
      debtorName:
        zahler.quelle === "selbst" ? debtorNameFor(member, contract) : displayName(zahlerMember),
      debtorIbanLast4: zahlerMember.iban1Last4 ?? iban.slice(-4),
      debtorBic: zahlerMember.bic1 ?? null,
      zahlerMemberId: zahler.zahlerId,
      zahlerQuelle: zahler.quelle,
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

  let invoiceCents = 0n;
  for (const inv of invoices) invoiceCents += amountStrToCents(inv.amount);

  if (candidates.length === 0 && invoices.length === 0) {
    issues.push({ level: "warning", message: "Keine berechtigten Mitglieder gefunden." });
  }

  return {
    candidates,
    excluded,
    invoices,
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
      invoiceTotal: centsToAmount(invoiceCents),
      invoiceCount: invoices.length,
    },
    issues,
  };
}

function emptyResult(): Preview {
  return {
    candidates: [],
    excluded: [],
    invoices: [],
    conflicts: [],
    totals: { grandTotal: "0.00", count: 0, byCategory: {}, invoiceTotal: "0.00", invoiceCount: 0 },
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

export type BeitragModus = "voll" | "anteilig";
export type AnteilEinheit = "monat" | "tag";

export type ProrationResult = {
  /** Fraction of the annual fee to charge, 0..1. */
  factor: number;
  /** Human label for the preview, or null when the full year is charged. */
  label: string | null;
};

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/** Inclusive whole-day difference between two UTC dates. */
function dayDiffInclusive(from: Date, to: Date): number {
  const ms = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  const msFrom = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  return Math.floor((ms - msFrom) / 86_400_000) + 1;
}

/**
 * Compute the share of the annual fee a contract is due for the given billing
 * year. `modus === "voll"` always returns factor 1 (current behaviour). For
 * "anteilig", the active interval [start, end] is clamped to the year and
 * measured either by calendar months touched (any active day counts the whole
 * month) or by inclusive day count.
 */
export function computeProration(opts: {
  start: Date | null;
  end: Date | null;
  year: number;
  modus: BeitragModus;
  einheit: AnteilEinheit;
}): ProrationResult {
  if (opts.modus === "voll") return { factor: 1, label: null };

  const yearStart = new Date(Date.UTC(opts.year, 0, 1));
  const yearEnd = new Date(Date.UTC(opts.year, 11, 31));
  const from = opts.start && opts.start > yearStart ? opts.start : yearStart;
  const to = opts.end && opts.end < yearEnd ? opts.end : yearEnd;
  if (to < from) return { factor: 0, label: "0 (außerhalb des Jahres)" };

  if (opts.einheit === "monat") {
    const months = to.getUTCMonth() - from.getUTCMonth() + 1;
    if (months >= 12) return { factor: 1, label: null };
    return { factor: months / 12, label: `${months}/12 Monate` };
  }

  const total = daysInYear(opts.year);
  const active = dayDiffInclusive(from, to);
  if (active >= total) return { factor: 1, label: null };
  return { factor: active / total, label: `${active}/${total} Tage` };
}

/** Multiply cents by a 0..1 factor with cent precision (banker-free rounding). */
function applyFactor(cents: bigint, factor: number): bigint {
  if (factor >= 1) return cents;
  if (factor <= 0) return 0n;
  const scaled = BigInt(Math.round(factor * 1_000_000));
  return (cents * scaled) / 1_000_000n;
}

function parseAmount(s: string | null | undefined): number {
  if (s == null || s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function toCents(n: number): bigint {
  return BigInt(Math.round(n * 100));
}

export function amountStrToCents(s: string): bigint {
  const trimmed = s.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative || trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  const [intp = "0", fracp = ""] = unsigned.split(".");
  const frac = `${fracp}00`.slice(0, 2);
  // Build the magnitude from the unsigned parts, then apply the sign once.
  // (Splitting the sign onto only the integer part would drop the cents'
  // sign, e.g. "-5.50" -> -5*100 + 50 = -450 instead of -550.)
  const magnitude = BigInt(intp || "0") * 100n + BigInt(frac || "0");
  return negative ? -magnitude : magnitude;
}

export function centsToAmount(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, "0")}`;
}
