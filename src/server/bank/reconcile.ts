/**
 * Bank statement reconciliation: parse a CSV export of account transactions and
 * match the incoming credits against open postings (Sollstellungen). Pure and
 * dependency-free so the matching is fully unit-tested; the procedure layer adds
 * the DB load and the (separately confirmed) write.
 *
 * Matching is deliberately conservative: a proposal is only "high" confidence
 * when a member reference or surname appears in the transaction text AND the
 * amount equals an open posting to the cent. Everything else is surfaced as
 * unmatched for a human to decide. Nothing here writes to the database.
 */

export type BankRow = {
  /** 1-based source line for display. */
  line: number;
  date: string | null;
  amount: number; // positive = credit (Geldeingang)
  name: string;
  purpose: string;
};

export type OpenPosting = {
  sollStellungId: string;
  memberId: string;
  reference: string; // memberNo / kontaktNo / mitgliedsnummer fallback
  mitgliedsnummer: string | null;
  nachname: string | null;
  memberName: string;
  billingYear: number;
  openAmount: number;
};

export type MatchConfidence = "high" | "medium" | "none";

export type MatchProposal = {
  row: BankRow;
  posting: OpenPosting | null;
  confidence: MatchConfidence;
  reason: string;
};

/** Filter open postings for the manual reconciliation picker. */
export function searchOpenPostings(
  postings: OpenPosting[],
  query: string,
  limit: number,
): OpenPosting[] {
  const normalized = query.trim().toLocaleLowerCase("de-DE");
  return postings
    .filter((posting) => {
      if (!normalized) return true;
      return [
        posting.memberName,
        posting.reference,
        posting.mitgliedsnummer,
        posting.nachname,
        posting.billingYear,
      ].some((value) =>
        String(value ?? "")
          .toLocaleLowerCase("de-DE")
          .includes(normalized),
      );
    })
    .slice(0, limit);
}

/** German amount "1.234,56" / "-12,50" / "1234.56" / "1.234" -> number, or NaN. */
export function parseGermanAmount(raw: string): number {
  const s = raw.trim().replace(/\s|€|EUR/gi, "");
  if (!s) return Number.NaN;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  // The rightmost separator is the decimal point only when it is followed by
  // exactly one or two digits; otherwise both separators are thousands groupers
  // ("1.234" -> 1234, not 1.234). This keeps whole-euro amounts with a
  // thousands dot from being parsed 1000x too small.
  const decimalIdx = Math.max(lastComma, lastDot);
  if (decimalIdx >= 0) {
    const trailing = s.length - decimalIdx - 1;
    if (trailing >= 1 && trailing <= 2) {
      const intPart = s.slice(0, decimalIdx).replace(/[.,]/g, "");
      const fracPart = s.slice(decimalIdx + 1);
      return Number.parseFloat(`${intPart}.${fracPart}`);
    }
  }
  // No decimal separator: every dot/comma is a thousands grouper.
  return Number.parseFloat(s.replace(/[.,]/g, ""));
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const AMOUNT_KEYS = ["betrag", "umsatz", "amount", "buchungsbetrag"];
const PURPOSE_KEYS = ["verwendungszweck", "verwendung", "vwz", "buchungstext", "purpose"];
const NAME_KEYS = [
  "name",
  "auftraggeber",
  "beguenstigter",
  "begünstigter",
  "empfänger",
  "zahlungspflichtiger",
  "kontoinhaber",
  "beguenstigter/zahlungspflichtiger",
];
const DATE_KEYS = ["datum", "buchungstag", "valuta", "wertstellung", "date"];

function findCol(header: string[], keys: string[]): number {
  for (let i = 0; i < header.length; i += 1) {
    const h = header[i]?.toLowerCase() ?? "";
    if (keys.some((k) => h.includes(k))) return i;
  }
  return -1;
}

export type ParseResult = { rows: BankRow[]; warnings: string[] };

/** Parse a bank CSV export into normalized credit/debit rows. */
export function parseBankCsv(text: string): ParseResult {
  const warnings: string[] = [];
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], warnings: ["Datei enthält keine Datenzeilen."] };

  // Delimiter: prefer the one that yields more columns in the header.
  const semi = splitCsvLine(lines[0]!, ";").length;
  const comma = splitCsvLine(lines[0]!, ",").length;
  const delim = semi >= comma ? ";" : ",";

  const header = splitCsvLine(lines[0]!, delim).map((h) => h.toLowerCase());
  const amountCol = findCol(header, AMOUNT_KEYS);
  const purposeCol = findCol(header, PURPOSE_KEYS);
  const nameCol = findCol(header, NAME_KEYS);
  const dateCol = findCol(header, DATE_KEYS);

  if (amountCol === -1) {
    return {
      rows: [],
      warnings: ["Keine Betrags-Spalte gefunden (erwartet z. B. 'Betrag' oder 'Umsatz')."],
    };
  }

  const rows: BankRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]!, delim);
    const amount = parseGermanAmount(cols[amountCol] ?? "");
    if (!Number.isFinite(amount)) continue;
    rows.push({
      line: i + 1,
      date: dateCol >= 0 ? (cols[dateCol] ?? null) : null,
      amount,
      name: nameCol >= 0 ? (cols[nameCol] ?? "") : "",
      purpose: purposeCol >= 0 ? (cols[purposeCol] ?? "") : "",
    });
  }
  if (rows.length === 0) warnings.push("Keine gültigen Buchungszeilen erkannt.");
  return { rows, warnings };
}

const cents = (n: number) => Math.round(n * 100);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-token match: `needle` bounded by non-alphanumeric (or string ends). */
function containsToken(hay: string, needle: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRe(needle)}([^a-z0-9]|$)`, "i").test(hay);
}

/**
 * Propose a matching open posting for each incoming credit. Greedy: each
 * posting is consumed by at most one row, and a high-confidence reference+amount
 * match wins over a name-only guess.
 */
export function matchBankTransactions(
  bankRows: BankRow[],
  postings: OpenPosting[],
): MatchProposal[] {
  const used = new Set<string>();
  const proposals: MatchProposal[] = [];

  for (const row of bankRows) {
    if (row.amount <= 0) {
      proposals.push({ row, posting: null, confidence: "none", reason: "Keine Gutschrift" });
      continue;
    }
    const hay = `${row.purpose} ${row.name}`.toLowerCase();
    const amountCents = cents(row.amount);

    const candidates = postings.filter((p) => {
      if (used.has(p.sollStellungId)) return false;
      const ref = p.reference.toLowerCase();
      const mgl = (p.mitgliedsnummer ?? "").toLowerCase();
      const name = (p.nachname ?? "").toLowerCase();
      // The app reference (M-/K-...) is distinctive enough for a substring hit;
      // member numbers and surnames must match as a whole token so a short name
      // like "Bauer" cannot accidentally match unrelated purpose text.
      const refHit = ref.length >= 4 && hay.includes(ref);
      const mglHit = mgl.length >= 3 && containsToken(hay, mgl);
      const nameHit = name.length >= 4 && containsToken(hay, name);
      return refHit || mglHit || nameHit;
    });

    // Prefer an exact amount match among the reference/name candidates.
    const exact = candidates.find((p) => cents(p.openAmount) === amountCents);
    if (exact) {
      used.add(exact.sollStellungId);
      proposals.push({
        row,
        posting: exact,
        confidence: "high",
        reason: "Referenz und Betrag stimmen überein",
      });
      continue;
    }
    if (candidates.length === 1) {
      used.add(candidates[0]!.sollStellungId);
      proposals.push({
        row,
        posting: candidates[0]!,
        confidence: "medium",
        reason: "Mitglied erkannt, Betrag weicht ab",
      });
      continue;
    }
    proposals.push({
      row,
      posting: null,
      confidence: "none",
      reason: candidates.length > 1 ? "Mehrere mögliche Mitglieder" : "Kein Treffer",
    });
  }

  return proposals;
}
