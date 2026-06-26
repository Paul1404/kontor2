import { normalizeIban, validateIban } from "~/server/sepa/iban";

/**
 * Dependency-free reader + validator for SEPA Core Direct Debit files
 * (pain.008.001.02, the German DK profile). Parses the XML, lays out exactly
 * what would be debited, and runs the checks a bank's validator (SFirm /
 * Bundesbank) would: control sums, IBAN/BIC/creditor-id checksums, valid and
 * non-future mandate dates, collection date plausibility, charset and length
 * limits, duplicate end-to-end ids. Pure and unit-tested; no DB, no network.
 */

export type Severity = "error" | "warning" | "info";
export type Finding = { severity: Severity; code: string; message: string; where?: string };

export type Pain008Transaction = {
  sequenceType: string;
  endToEndId: string;
  debtorName: string;
  debtorIban: string;
  debtorBic: string | null;
  amount: string;
  currency: string;
  mandateId: string;
  signatureDate: string;
  purpose: string | null;
};

export type Pain008Result = {
  ok: boolean;
  format: string | null;
  summary: {
    messageId: string;
    creationDateTime: string;
    initiatingParty: string;
    creditorName: string;
    creditorIban: string;
    creditorBic: string | null;
    creditorId: string;
    declaredCount: number;
    computedCount: number;
    declaredSum: string;
    computedSum: string;
    currency: string;
    collectionDates: string[];
    bySequence: Record<string, { count: number; sum: string }>;
  };
  transactions: Pain008Transaction[];
  findings: Finding[];
  counts: { errors: number; warnings: number; infos: number };
};

// ---------------------------------------------------------------- XML parsing

type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

/** Strip namespace prefix; pain.008 uses a default namespace, prefixes are rare. */
function localName(n: string): string {
  const i = n.indexOf(":");
  return i === -1 ? n : n.slice(i + 1);
}

/** Minimal XML parser for the pain.008 profile: elements, the one `Ccy`
 *  attribute, text and entities. No CDATA, mixed content or PIs beyond the
 *  declaration, which this file format never uses. */
export function parseXml(input: string): XmlNode {
  let s = input.replace(/^﻿/, "");
  s = s.replace(/<\?xml[\s\S]*?\?>/g, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((m = tagRe.exec(s)) !== null) {
    if (m[5] !== undefined) {
      const text = decodeEntities(m[5]).trim();
      if (text && stack.length > 0) stack[stack.length - 1]!.text += text;
      continue;
    }
    const closing = m[1] === "/";
    if (closing) {
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    const attrRe = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
    let a: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
    while ((a = attrRe.exec(m[3] ?? "")) !== null) attrs[localName(a[1]!)] = decodeEntities(a[2]!);
    const node: XmlNode = { name: localName(m[2]!), attrs, children: [], text: "" };
    if (stack.length > 0) stack[stack.length - 1]!.children.push(node);
    else root = node;
    if (m[4] !== "/") stack.push(node);
  }
  if (!root) throw new Error("Kein gültiges XML-Wurzelelement gefunden.");
  return root;
}

const kids = (n: XmlNode | undefined, name: string): XmlNode[] =>
  n ? n.children.filter((c) => c.name === name) : [];
const kid = (n: XmlNode | undefined, name: string): XmlNode | undefined => kids(n, name)[0];
/** Text of a nested path, e.g. txt(node, "PmtId", "EndToEndId"). */
function txt(n: XmlNode | undefined, ...path: string[]): string {
  let cur = n;
  for (const p of path) cur = kid(cur, p);
  return cur?.text ?? "";
}

// --------------------------------------------------------------- validation

const ALLOWED_SEQ = new Set(["FRST", "RCUR", "OOFF", "FNAL"]);
// EPC-allowed SEPA character set for names/remittance.
const SEPA_CHARSET = /^[A-Za-z0-9/?:().,'+\-\s]*$/;

function isValidBic(bic: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic.toUpperCase());
}

function mod97(num: string): number {
  let rem = 0;
  for (const d of num) rem = (rem * 10 + Number(d)) % 97;
  return rem;
}

/** EPC Creditor Identifier check: drop the 3-char business code, move the
 *  country+check to the end, letters to digits, mod 97 must be 1. */
export function isValidCreditorId(raw: string): boolean {
  const v = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(v)) return false;
  const stripped = v.slice(0, 4) + v.slice(7);
  const rearranged = stripped.slice(4) + stripped.slice(0, 4);
  let numeric = "";
  for (const ch of rearranged) {
    numeric += /[A-Z]/.test(ch) ? (ch.charCodeAt(0) - 55).toString() : ch;
  }
  return mod97(numeric) === 1;
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

function centsOf(amount: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) return null;
  return Math.round(Number.parseFloat(amount) * 100);
}

const fmt = (cents: number): string => (cents / 100).toFixed(2);

/**
 * Parse and validate a pain.008 file. `today` is injected (YYYY-MM-DD) so the
 * function stays pure and testable; callers pass the current date.
 */
export function validatePain008(xml: string, today: string): Pain008Result {
  const findings: Finding[] = [];
  const add = (severity: Severity, code: string, message: string, where?: string) =>
    findings.push({ severity, code, message, where });

  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch (err) {
    add("error", "XML_PARSE", `XML konnte nicht gelesen werden: ${(err as Error).message}`);
    return emptyResult(null, findings);
  }

  const nsMatch = xml.match(/xmlns="([^"]*pain\.008[^"]*)"/);
  const format = nsMatch?.[1] ?? null;
  if (!format) {
    add("error", "FORMAT", "Kein pain.008-Namespace gefunden. Ist das eine SEPA-Lastschriftdatei?");
  } else if (!format.includes("pain.008.001.02")) {
    add(
      "warning",
      "FORMAT_VERSION",
      `Format ${format}. Geprüft wird der deutsche Standard pain.008.001.02; andere Versionen werden bestmöglich gelesen.`,
    );
  }

  if (root.name !== "Document") {
    add("error", "ROOT", `Wurzelelement ist <${root.name}>, erwartet <Document>.`);
  }
  const cstmr = kid(root, "CstmrDrctDbtInitn");
  if (!cstmr) {
    add("error", "STRUCTURE", "Element <CstmrDrctDbtInitn> fehlt.");
    return emptyResult(format, findings);
  }

  const grpHdr = kid(cstmr, "GrpHdr");
  const messageId = txt(grpHdr, "MsgId");
  const creationDateTime = txt(grpHdr, "CreDtTm");
  const initiatingParty = txt(grpHdr, "InitgPty", "Nm");
  const declaredCount = Number.parseInt(txt(grpHdr, "NbOfTxs"), 10) || 0;
  const declaredSumStr = txt(grpHdr, "CtrlSum");

  if (!messageId) add("error", "GRP_MSGID", "GrpHdr: MsgId fehlt.");
  else if (messageId.length > 35) add("error", "GRP_MSGID_LEN", "MsgId ist länger als 35 Zeichen.");
  if (!creationDateTime) add("warning", "GRP_CREDTTM", "GrpHdr: CreDtTm (Erstellzeit) fehlt.");

  const pmtInfs = kids(cstmr, "PmtInf");
  if (pmtInfs.length === 0) add("error", "NO_PMTINF", "Keine Zahlungsgruppe (PmtInf) gefunden.");

  const transactions: Pain008Transaction[] = [];
  const bySequence: Record<string, { count: number; sum: number }> = {};
  const collectionDates = new Set<string>();
  const seenEndToEnd = new Set<string>();
  const creditorIds = new Set<string>();
  let creditorName = "";
  let creditorIban = "";
  let creditorBic: string | null = null;
  let creditorId = "";
  let computedCents = 0;

  for (const [pi, pmtInf] of pmtInfs.entries()) {
    const where = `Gruppe ${pi + 1}`;
    const pmtMtd = txt(pmtInf, "PmtMtd");
    if (pmtMtd !== "DD") add("error", "PMT_MTD", `PmtMtd ist „${pmtMtd}", erwartet „DD".`, where);

    const seqTp = txt(pmtInf, "PmtTpInf", "SeqTp");
    if (!ALLOWED_SEQ.has(seqTp)) add("error", "SEQ_TP", `Ungültiger SeqTp „${seqTp}".`, where);
    const svcLvl = txt(pmtInf, "PmtTpInf", "SvcLvl", "Cd");
    if (svcLvl !== "SEPA")
      add("warning", "SVC_LVL", `SvcLvl ist „${svcLvl}", erwartet „SEPA".`, where);
    const lclInstrm = txt(pmtInf, "PmtTpInf", "LclInstrm", "Cd");
    if (!["CORE", "COR1", "B2B"].includes(lclInstrm))
      add("warning", "LCL_INSTRM", `LclInstrm ist „${lclInstrm}".`, where);

    const reqdColltnDt = txt(pmtInf, "ReqdColltnDt");
    if (!isIsoDate(reqdColltnDt)) {
      add(
        "error",
        "COLLTN_DT",
        `Fälligkeitsdatum „${reqdColltnDt}" ist kein gültiges Datum.`,
        where,
      );
    } else {
      collectionDates.add(reqdColltnDt);
      if (reqdColltnDt < today)
        add(
          "error",
          "COLLTN_PAST",
          `Fälligkeit ${reqdColltnDt} liegt in der Vergangenheit.`,
          where,
        );
      const dow = new Date(`${reqdColltnDt}T00:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 6)
        add(
          "warning",
          "COLLTN_WEEKEND",
          `Fälligkeit ${reqdColltnDt} ist ein Wochenende (kein Bankarbeitstag).`,
          where,
        );
    }

    creditorName ||= txt(pmtInf, "Cdtr", "Nm");
    creditorIban ||= txt(pmtInf, "CdtrAcct", "Id", "IBAN");
    const cdtrBic = txt(pmtInf, "CdtrAgt", "FinInstnId", "BIC");
    if (cdtrBic) creditorBic ||= cdtrBic;
    const cid = txt(pmtInf, "CdtrSchmeId", "Id", "PrvtId", "Othr", "Id");
    if (cid) {
      creditorId ||= cid;
      creditorIds.add(cid);
    }

    const declaredBlockCount = Number.parseInt(txt(pmtInf, "NbOfTxs"), 10) || 0;
    const declaredBlockSum = txt(pmtInf, "CtrlSum");
    const txInfs = kids(pmtInf, "DrctDbtTxInf");
    let blockCents = 0;

    for (const tx of txInfs) {
      const endToEndId = txt(tx, "PmtId", "EndToEndId");
      const amtNode = kid(tx, "InstdAmt");
      const amount = amtNode?.text ?? "";
      const currency = amtNode?.attrs.Ccy ?? "";
      const mandateId = txt(tx, "DrctDbtTx", "MndtRltdInf", "MndtId");
      const signatureDate = txt(tx, "DrctDbtTx", "MndtRltdInf", "DtOfSgntr");
      const debtorName = txt(tx, "Dbtr", "Nm");
      const debtorIban = txt(tx, "DbtrAcct", "Id", "IBAN");
      const dbtrBic = txt(tx, "DbtrAgt", "FinInstnId", "BIC");
      const dbtrOthr = txt(tx, "DbtrAgt", "FinInstnId", "Othr", "Id");
      const purpose = txt(tx, "RmtInf", "Ustrd") || null;
      const txWhere = `${where}, ${debtorName || endToEndId || "Posten"}`;

      const cents = centsOf(amount);
      if (cents == null) add("error", "AMT", `Betrag „${amount}" ist ungültig.`, txWhere);
      else {
        if (cents <= 0) add("error", "AMT_ZERO", "Betrag ist 0 oder negativ.", txWhere);
        if (cents > 99999999999)
          add("error", "AMT_MAX", "Betrag über 999.999.999,99 EUR.", txWhere);
        blockCents += cents;
        computedCents += cents;
      }
      if (currency !== "EUR") add("error", "CCY", `Währung „${currency}", erwartet EUR.`, txWhere);

      if (!endToEndId) add("warning", "E2E_MISSING", "EndToEndId fehlt.", txWhere);
      else if (endToEndId.length > 35)
        add("error", "E2E_LEN", "EndToEndId länger als 35 Zeichen.", txWhere);
      else if (seenEndToEnd.has(endToEndId))
        add("error", "E2E_DUP", `EndToEndId „${endToEndId}" kommt doppelt vor.`, txWhere);
      seenEndToEnd.add(endToEndId);

      if (!mandateId) add("error", "MNDT_MISSING", "Mandatsreferenz (MndtId) fehlt.", txWhere);
      else if (mandateId.length > 35)
        add("error", "MNDT_LEN", "MndtId länger als 35 Zeichen.", txWhere);

      if (!isIsoDate(signatureDate)) {
        add(
          "error",
          "SGNTR_DT",
          `Mandatsdatum „${signatureDate}" ist kein gültiges Datum.`,
          txWhere,
        );
      } else {
        if (signatureDate > today)
          add(
            "error",
            "SGNTR_FUTURE",
            `Mandatsdatum ${signatureDate} liegt in der Zukunft.`,
            txWhere,
          );
        if (isIsoDate(reqdColltnDt) && signatureDate > reqdColltnDt)
          add(
            "error",
            "SGNTR_AFTER_COLLTN",
            `Mandatsdatum ${signatureDate} liegt nach der Fälligkeit.`,
            txWhere,
          );
      }

      if (!debtorName) add("error", "DBTR_NM", "Name des Zahlungspflichtigen fehlt.", txWhere);
      else {
        if (debtorName.length > 70)
          add("warning", "DBTR_NM_LEN", "Name länger als 70 Zeichen.", txWhere);
        if (!SEPA_CHARSET.test(debtorName))
          add(
            "warning",
            "DBTR_NM_CHARSET",
            `Name „${debtorName}" enthält Zeichen außerhalb des SEPA-Zeichensatzes.`,
            txWhere,
          );
      }
      if (!validateIban(debtorIban))
        add("error", "DBTR_IBAN", `IBAN „${debtorIban}" ist ungültig (Prüfziffer).`, txWhere);
      if (dbtrBic) {
        if (!isValidBic(dbtrBic))
          add("error", "DBTR_BIC", `BIC „${dbtrBic}" ist ungültig.`, txWhere);
      } else if (dbtrOthr === "NOTPROVIDED") {
        // IBAN-only is allowed for SEPA-internal collections; informational.
        add(
          "info",
          "DBTR_IBAN_ONLY",
          `${debtorName}: IBAN-only (BIC NOTPROVIDED), SEPA-konform.`,
          txWhere,
        );
      } else {
        add(
          "warning",
          "DBTR_AGT",
          "Keine BIC und kein NOTPROVIDED beim Zahlungspflichtigen.",
          txWhere,
        );
      }

      const seq = bySequence[seqTp] ?? { count: 0, sum: 0 };
      seq.count += 1;
      seq.sum += cents ?? 0;
      bySequence[seqTp] = seq;

      transactions.push({
        sequenceType: seqTp,
        endToEndId,
        debtorName,
        debtorIban: debtorIban ? normalizeIban(debtorIban) : "",
        debtorBic: dbtrBic || (dbtrOthr === "NOTPROVIDED" ? "NOTPROVIDED" : null),
        amount: cents != null ? fmt(cents) : amount,
        currency,
        mandateId,
        signatureDate,
        purpose,
      });
    }

    if (declaredBlockCount !== txInfs.length)
      add(
        "error",
        "BLK_COUNT",
        `Gruppe ${pi + 1}: NbOfTxs ${declaredBlockCount} ungleich ${txInfs.length} Posten.`,
        where,
      );
    const declaredBlockCents = centsOf(declaredBlockSum);
    if (declaredBlockCents == null || declaredBlockCents !== blockCents)
      add(
        "error",
        "BLK_SUM",
        `Gruppe ${pi + 1}: CtrlSum ${declaredBlockSum} ungleich errechneter ${fmt(blockCents)}.`,
        where,
      );
  }

  // Creditor-level checks.
  if (!creditorName) add("error", "CDTR_NM", "Gläubigername fehlt.");
  if (!validateIban(creditorIban))
    add("error", "CDTR_IBAN", `Gläubiger-IBAN „${creditorIban}" ist ungültig.`);
  if (creditorBic && !isValidBic(creditorBic))
    add("error", "CDTR_BIC", `Gläubiger-BIC „${creditorBic}" ist ungültig.`);
  if (!creditorId) add("error", "CDTR_ID_MISSING", "Gläubiger-ID (CdtrSchmeId) fehlt.");
  else if (!isValidCreditorId(creditorId))
    add("error", "CDTR_ID_INVALID", `Gläubiger-ID „${creditorId}" hat eine falsche Prüfziffer.`);
  if (creditorIds.size > 1)
    add("warning", "CDTR_ID_MIXED", "Mehrere unterschiedliche Gläubiger-IDs in einer Datei.");

  // Group totals.
  if (declaredCount !== transactions.length)
    add(
      "error",
      "GRP_COUNT",
      `GrpHdr NbOfTxs ${declaredCount} ungleich ${transactions.length} Posten gesamt.`,
    );
  const declaredCents = centsOf(declaredSumStr);
  if (declaredCents == null || declaredCents !== computedCents)
    add(
      "error",
      "GRP_SUM",
      `GrpHdr CtrlSum ${declaredSumStr} ungleich errechneter ${fmt(computedCents)}.`,
    );

  const counts = {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    infos: findings.filter((f) => f.severity === "info").length,
  };

  return {
    ok: counts.errors === 0,
    format,
    summary: {
      messageId,
      creationDateTime,
      initiatingParty,
      creditorName,
      creditorIban: creditorIban ? normalizeIban(creditorIban) : "",
      creditorBic,
      creditorId,
      declaredCount,
      computedCount: transactions.length,
      declaredSum: declaredCents != null ? fmt(declaredCents) : declaredSumStr,
      computedSum: fmt(computedCents),
      currency: "EUR",
      collectionDates: [...collectionDates].sort(),
      bySequence: Object.fromEntries(
        Object.entries(bySequence).map(([k, v]) => [k, { count: v.count, sum: fmt(v.sum) }]),
      ),
    },
    transactions,
    findings,
    counts,
  };
}

function emptyResult(format: string | null, findings: Finding[]): Pain008Result {
  return {
    ok: false,
    format,
    summary: {
      messageId: "",
      creationDateTime: "",
      initiatingParty: "",
      creditorName: "",
      creditorIban: "",
      creditorBic: null,
      creditorId: "",
      declaredCount: 0,
      computedCount: 0,
      declaredSum: "0.00",
      computedSum: "0.00",
      currency: "EUR",
      collectionDates: [],
      bySequence: {},
    },
    transactions: [],
    findings,
    counts: {
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      infos: findings.filter((f) => f.severity === "info").length,
    },
  };
}
