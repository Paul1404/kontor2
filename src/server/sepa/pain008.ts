/**
 * pain.008.001.02 (SEPA Customer Direct Debit Initiation) XML generator.
 *
 * Hand-rolled string concatenation -- the format is small, stable, and
 * well-documented. Reference: EBICS / Bundesbank specification, ISO 20022.
 *
 * Bundesbank rule we honour: FRST and RCUR transactions must live in
 * separate `<PmtInf>` blocks within the same document. We accept items
 * pre-grouped by sequence type.
 */

import { normalizeIban } from "~/server/sepa/iban";

export type Pain008Creditor = {
  name: string;
  iban: string;
  bic: string;
  glaeubigerId: string;
};

export type Pain008Item = {
  endToEndId: string;
  amount: string; // decimal string like "54.00"
  mandateRef: string;
  mandateSignatureDate: string; // YYYY-MM-DD
  debtorName: string;
  debtorIban: string;
  debtorBic?: string | null;
  purpose: string;
  sequenceType: "FRST" | "RCUR" | "OOFF" | "FNAL";
};

export type Pain008Input = {
  creditor: Pain008Creditor;
  falligkeitsdatum: string; // YYYY-MM-DD
  msgId: string; // max 35 chars, unique per submission
  pmtInfIdPrefix: string; // suffixed with -FRST / -RCUR per block
  createdAtIso?: string; // ISO 8601 with seconds, used as CreDtTm. Defaults to now.
  items: Pain008Item[];
};

export function buildPain008(input: Pain008Input): string {
  const createdAt = (input.createdAtIso ?? new Date().toISOString()).replace(/\.\d{3}Z$/, "");
  const grouped = groupBySequenceType(input.items);
  const totals = computeTotals(input.items);

  const blocks = (["FRST", "RCUR", "OOFF", "FNAL"] as const)
    .filter((seq) => grouped[seq].length > 0)
    .map((seq) =>
      paymentInfoBlock({
        pmtInfId: `${input.pmtInfIdPrefix}-${seq}`,
        sequenceType: seq,
        falligkeitsdatum: input.falligkeitsdatum,
        creditor: input.creditor,
        items: grouped[seq],
      }),
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${esc(input.msgId)}</MsgId>
      <CreDtTm>${esc(createdAt)}</CreDtTm>
      <NbOfTxs>${totals.count}</NbOfTxs>
      <CtrlSum>${formatAmount(totals.sum)}</CtrlSum>
      <InitgPty>
        <Nm>${esc(sepaText(input.creditor.name))}</Nm>
        <Id>
          <OrgId>
            <Othr>
              <Id>${esc(input.creditor.glaeubigerId)}</Id>
            </Othr>
          </OrgId>
        </Id>
      </InitgPty>
    </GrpHdr>
${blocks}
  </CstmrDrctDbtInitn>
</Document>
`;
}

function paymentInfoBlock(opts: {
  pmtInfId: string;
  sequenceType: "FRST" | "RCUR" | "OOFF" | "FNAL";
  falligkeitsdatum: string;
  creditor: Pain008Creditor;
  items: Pain008Item[];
}): string {
  const totals = computeTotals(opts.items);
  const txns = opts.items.map((it) => txInfo(it)).join("\n");
  return `    <PmtInf>
      <PmtInfId>${esc(opts.pmtInfId)}</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${totals.count}</NbOfTxs>
      <CtrlSum>${formatAmount(totals.sum)}</CtrlSum>
      <PmtTpInf>
        <SvcLvl><Cd>SEPA</Cd></SvcLvl>
        <LclInstrm><Cd>CORE</Cd></LclInstrm>
        <SeqTp>${opts.sequenceType}</SeqTp>
      </PmtTpInf>
      <ReqdColltnDt>${esc(opts.falligkeitsdatum)}</ReqdColltnDt>
      <Cdtr><Nm>${esc(sepaText(opts.creditor.name))}</Nm></Cdtr>
      <CdtrAcct><Id><IBAN>${esc(normalizeIban(opts.creditor.iban))}</IBAN></Id></CdtrAcct>
      <CdtrAgt><FinInstnId><BIC>${esc(opts.creditor.bic)}</BIC></FinInstnId></CdtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      <CdtrSchmeId>
        <Id>
          <PrvtId>
            <Othr>
              <Id>${esc(opts.creditor.glaeubigerId)}</Id>
              <SchmeNm><Prtry>SEPA</Prtry></SchmeNm>
            </Othr>
          </PrvtId>
        </Id>
      </CdtrSchmeId>
${txns}
    </PmtInf>`;
}

function txInfo(it: Pain008Item): string {
  const dbtrAgt = it.debtorBic
    ? `<DbtrAgt><FinInstnId><BIC>${esc(it.debtorBic)}</BIC></FinInstnId></DbtrAgt>`
    : `<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>`;
  return `      <DrctDbtTxInf>
        <PmtId><EndToEndId>${esc(it.endToEndId)}</EndToEndId></PmtId>
        <InstdAmt Ccy="EUR">${formatAmount(it.amount)}</InstdAmt>
        <DrctDbtTx>
          <MndtRltdInf>
            <MndtId>${esc(it.mandateRef)}</MndtId>
            <DtOfSgntr>${esc(it.mandateSignatureDate)}</DtOfSgntr>
          </MndtRltdInf>
        </DrctDbtTx>
        ${dbtrAgt}
        <Dbtr><Nm>${esc(truncate(sepaText(it.debtorName), 70))}</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>${esc(normalizeIban(it.debtorIban))}</IBAN></Id></DbtrAcct>
        <RmtInf><Ustrd>${esc(truncate(sepaText(it.purpose), 140))}</Ustrd></RmtInf>
      </DrctDbtTxInf>`;
}

function groupBySequenceType(items: Pain008Item[]) {
  const out: Record<"FRST" | "RCUR" | "OOFF" | "FNAL", Pain008Item[]> = {
    FRST: [],
    RCUR: [],
    OOFF: [],
    FNAL: [],
  };
  for (const it of items) out[it.sequenceType].push(it);
  return out;
}

function computeTotals(items: Pain008Item[]): { count: number; sum: string } {
  // Sum as integer cents to avoid floating-point drift, then format back.
  let cents = 0n;
  for (const it of items) cents += amountToCents(it.amount);
  return { count: items.length, sum: centsToAmount(cents) };
}

function amountToCents(s: string): bigint {
  const trimmed = s.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative || trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  const [intp = "0", fracp = ""] = unsigned.split(".");
  const frac = `${fracp}00`.slice(0, 2);
  // Apply the sign once to the whole magnitude: splitting it onto only the
  // integer part dropped the cents' sign ("-5.50" -> -450 instead of -550).
  const magnitude = BigInt(intp || "0") * 100n + BigInt(frac || "0");
  return negative ? -magnitude : magnitude;
}

function centsToAmount(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  const intp = (abs / 100n).toString();
  const fracp = (abs % 100n).toString().padStart(2, "0");
  return `${sign}${intp}.${fracp}`;
}

export function formatAmount(s: string): string {
  // Normalize "54", "54.0", "54.00000000" -> "54.00".
  const cents = amountToCents(s);
  return centsToAmount(cents);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const SEPA_UMLAUTS: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ß: "ss",
};

/**
 * Restrict free text to the SEPA (EPC) Latin character set
 * `a-z A-Z 0-9 / - ? : ( ) . , ' + space`. Banks reject a pain.008 whose
 * names or remittance info contain anything else, and for a German club that
 * is virtually every batch ("Schäfer", "München", "Straße"). German umlauts
 * and ß get the conventional transliteration (ä->ae, ß->ss); other accents are
 * stripped to their base letter (é->e); anything still out of range becomes a
 * space. Apply to debtor/creditor names and remittance info only -- not to the
 * mandate reference or EndToEndId, which must match what the bank registered.
 */
export function sepaText(s: string): string {
  return s
    .replace(/[äöüÄÖÜß]/g, (c) => SEPA_UMLAUTS[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const __test = { amountToCents, centsToAmount, esc, truncate, sepaText };
