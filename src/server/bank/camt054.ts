/**
 * camt.054 (Bank-to-Customer Debit/Credit Notification) parser, focused on
 * SEPA-Rücklastschriften (R-Transactions). The bank delivers a camt.054 file
 * listing each failed direct debit; we extract the EndToEndId so the return can
 * be matched back to the originating `fee_run_item` and the Sollstellung
 * reopened.
 *
 * Pure and dependency-free, mirroring the hand-rolled pain.008 generator: the
 * format is small and stable, and a tiny tag walker keeps it fully unit-tested
 * without pulling in an XML library. Nothing here touches the database.
 *
 * We only emit entries that carry a return reason (`RtrInf`) -- that is what
 * distinguishes an R-Transaction from an ordinary booking, so a notification
 * that also lists normal credits never produces phantom returns.
 */

export type Camt054Return = {
  /** PmtId/EndToEndId -- the key we matched against fee_run_items.endToEndId. */
  endToEndId: string | null;
  /** Returned amount as a positive number (EUR). */
  amount: number;
  currency: string | null;
  /** ISO R-Transaction reason code (AM04, MS03, ...) or a proprietary string. */
  reasonCode: string | null;
  /** Free-text additional info from the bank, if any. */
  reasonText: string | null;
  /** Booking date YYYY-MM-DD, or null when the file omits it. */
  returnedOn: string | null;
  debtorName: string | null;
};

export type Camt054Result = {
  returns: Camt054Return[];
  warnings: string[];
};

// --- Minimal XML tree --------------------------------------------------------

type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
};

function decodeEntities(s: string): string {
  return (
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
      // Ampersand last so a literal "&amp;lt;" is not double-decoded.
      .replace(/&amp;/g, "&")
  );
}

/** Strip an optional namespace prefix: `ns:Ntry` -> `Ntry`. */
function localName(tag: string): string {
  const i = tag.indexOf(":");
  return i >= 0 ? tag.slice(i + 1) : tag;
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/([\w.\-:]+)\s*=\s*"([^"]*)"/g)) {
    out[localName(m[1]!)] = decodeEntities(m[2]!);
  }
  return out;
}

/** Tolerant, namespace-agnostic XML parser producing a node tree. */
function parseXml(xml: string): XmlNode {
  const cleaned = xml
    .replace(/^﻿/, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner) => inner);

  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const token = /<(\/)?([A-Za-z_][\w.\-:]*)([^>]*?)(\/)?>|([^<]+)/g;
  for (const m of cleaned.matchAll(token)) {
    const [, closing, name, attrs, selfClose, textRaw] = m;
    const top = stack[stack.length - 1]!;
    if (textRaw != null) {
      const txt = decodeEntities(textRaw).trim();
      if (txt) top.text += top.text ? ` ${txt}` : txt;
      continue;
    }
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node: XmlNode = {
      name: localName(name!),
      attrs: attrs ? parseAttrs(attrs) : {},
      children: [],
      text: "",
    };
    top.children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

function firstChild(node: XmlNode, name: string): XmlNode | null {
  for (const c of node.children) if (c.name === name) return c;
  return null;
}

/** First descendant (depth-first) with the given local name. */
function firstDescendant(node: XmlNode, name: string): XmlNode | null {
  for (const c of node.children) {
    if (c.name === name) return c;
    const deep = firstDescendant(c, name);
    if (deep) return deep;
  }
  return null;
}

function descendants(node: XmlNode, name: string, acc: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name) acc.push(c);
    descendants(c, name, acc);
  }
  return acc;
}

function textOf(node: XmlNode | null): string | null {
  const t = node?.text.trim();
  return t ? t : null;
}

/** Pull a date from an `<X><Dt>...</Dt></X>` or `<X><DtTm>...</DtTm></X>` block. */
function dateFrom(node: XmlNode | null): string | null {
  if (!node) return null;
  const raw = textOf(firstChild(node, "Dt")) ?? textOf(firstChild(node, "DtTm")) ?? textOf(node);
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return m ? m[1]! : null;
}

function parseEuro(raw: string | null): number {
  if (!raw) return Number.NaN;
  return Number.parseFloat(raw.replace(/\s/g, ""));
}

/**
 * Parse a camt.054 document into the list of returned direct debits. Robust to
 * namespace prefixes and to either one-TxDtls-per-entry or batched entries.
 */
export function parseCamt054(xml: string): Camt054Result {
  const warnings: string[] = [];
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch {
    return { returns: [], warnings: ["Datei konnte nicht als XML gelesen werden."] };
  }

  const entries = descendants(root, "Ntry");
  if (entries.length === 0) {
    return { returns: [], warnings: ["Keine Buchungen (Ntry) in der Datei gefunden."] };
  }

  const returns: Camt054Return[] = [];
  let entriesWithoutReturn = 0;

  for (const ntry of entries) {
    const bookingDate =
      dateFrom(firstChild(ntry, "BookgDt")) ?? dateFrom(firstChild(ntry, "ValDt"));
    const entryAmtNode = firstChild(ntry, "Amt");
    const entryCcy = entryAmtNode?.attrs.Ccy ?? null;

    const txDetails = descendants(ntry, "TxDtls");
    // A batched entry without per-transaction detail still counts as one return
    // when the entry itself carries a reason.
    const units = txDetails.length > 0 ? txDetails : [ntry];

    for (const tx of units) {
      const rtrInf = firstDescendant(tx, "RtrInf");
      if (!rtrInf) {
        entriesWithoutReturn += 1;
        continue;
      }

      const rsn = firstChild(rtrInf, "Rsn");
      const reasonCode =
        (rsn && (textOf(firstChild(rsn, "Cd")) ?? textOf(firstChild(rsn, "Prtry")))) ?? null;
      const reasonText = textOf(firstChild(rtrInf, "AddtlInf"));

      // Amount: prefer the transaction's own amount, fall back to the entry.
      const txAmtNode =
        firstDescendant(tx, "TxAmt")?.children.find((c) => c.name === "Amt") ??
        firstChild(tx, "Amt") ??
        entryAmtNode;
      const amount = Math.abs(parseEuro(textOf(txAmtNode ?? null)));
      const currency = txAmtNode?.attrs.Ccy ?? entryCcy;

      const endToEndId = textOf(firstDescendant(tx, "EndToEndId"));
      const dbtr = firstDescendant(tx, "Dbtr");
      const debtorName = dbtr ? textOf(firstChild(dbtr, "Nm")) : null;

      returns.push({
        endToEndId,
        amount: Number.isFinite(amount) ? amount : 0,
        currency,
        reasonCode,
        reasonText,
        returnedOn: bookingDate,
        debtorName,
      });
    }
  }

  if (returns.length === 0) {
    warnings.push("Keine Rücklastschriften (mit Rückgabegrund) in der Datei gefunden.");
  }
  if (entriesWithoutReturn > 0 && returns.length > 0) {
    warnings.push(`${entriesWithoutReturn} Buchung(en) ohne Rückgabegrund übersprungen.`);
  }
  return { returns, warnings };
}

// --- Matching against committed direct-debit items --------------------------

export type ReturnableItem = {
  feeRunItemId: string;
  endToEndId: string;
  amount: string; // decimal string
  alreadyReturned: boolean;
};

export type CamtMatch = {
  ret: Camt054Return;
  item: ReturnableItem | null;
  status: "matched" | "already_returned" | "unmatched";
};

/**
 * Match parsed returns to fee-run items by EndToEndId (the value we wrote into
 * the original pain.008, so it is exact). Each item is consumed at most once.
 */
export function matchCamtReturns(returns: Camt054Return[], items: ReturnableItem[]): CamtMatch[] {
  const byE2E = new Map<string, ReturnableItem>();
  for (const it of items) byE2E.set(it.endToEndId, it);

  const used = new Set<string>();
  return returns.map((ret) => {
    const e2e = ret.endToEndId ?? "";
    const item = e2e ? byE2E.get(e2e) : undefined;
    if (!item || used.has(item.feeRunItemId)) {
      return { ret, item: null, status: "unmatched" as const };
    }
    if (item.alreadyReturned) {
      return { ret, item, status: "already_returned" as const };
    }
    used.add(item.feeRunItemId);
    return { ret, item, status: "matched" as const };
  });
}
