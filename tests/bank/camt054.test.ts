import { describe, expect, it } from "vitest";
import {
  type Camt054Return,
  matchCamtReturns,
  parseCamt054,
  type ReturnableItem,
} from "~/server/bank/camt054";

// A trimmed but structurally faithful camt.054.001.02 with two returned SEPA
// direct debits, one with an ISO reason code and one with a proprietary reason.
const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02">
  <BkToCstmrDbtCdtNtfctn>
    <Ntfctn>
      <Ntry>
        <Amt Ccy="EUR">54.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt><Dt>2026-02-15</Dt></BookgDt>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>E2E-AAA-001</EndToEndId></Refs>
            <AmtDtls><TxAmt><Amt Ccy="EUR">54.00</Amt></TxAmt></AmtDtls>
            <RtrInf>
              <Rsn><Cd>AM04</Cd></Rsn>
              <AddtlInf>Konto ohne Deckung</AddtlInf>
            </RtrInf>
            <RltdPties><Dbtr><Nm>Erika Mustermann</Nm></Dbtr></RltdPties>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">12.50</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt><Dt>2026-02-16</Dt></BookgDt>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>E2E-BBB-002</EndToEndId></Refs>
            <RtrInf>
              <Rsn><Prtry>SONST</Prtry></Rsn>
            </RtrInf>
            <RltdPties><Dbtr><Nm>Max Beispiel</Nm></Dbtr></RltdPties>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;

describe("parseCamt054", () => {
  it("extracts returned debits with reason, amount, date and debtor", () => {
    const { returns, warnings } = parseCamt054(CAMT);
    expect(warnings).toHaveLength(0);
    expect(returns).toHaveLength(2);

    const first = returns[0]!;
    expect(first.endToEndId).toBe("E2E-AAA-001");
    expect(first.amount).toBeCloseTo(54);
    expect(first.currency).toBe("EUR");
    expect(first.reasonCode).toBe("AM04");
    expect(first.reasonText).toBe("Konto ohne Deckung");
    expect(first.returnedOn).toBe("2026-02-15");
    expect(first.debtorName).toBe("Erika Mustermann");

    expect(returns[1]!.reasonCode).toBe("SONST");
    expect(returns[1]!.endToEndId).toBe("E2E-BBB-002");
  });

  it("handles namespace prefixes", () => {
    // Prefix every element tag with `ns:` (the XML declaration starts with `?`
    // and is left alone). The parser must strip the prefix to read fields.
    const prefixed = CAMT.replace(/<(\/?)([A-Za-z])/g, "<$1ns:$2");
    const { returns } = parseCamt054(prefixed);
    expect(returns).toHaveLength(2);
    expect(returns[0]!.endToEndId).toBe("E2E-AAA-001");
  });

  it("ignores entries without a return reason", () => {
    const noReturn = `<?xml version="1.0"?>
<Document><BkToCstmrDbtCdtNtfctn><Ntfctn>
  <Ntry><Amt Ccy="EUR">10.00</Amt><BookgDt><Dt>2026-01-01</Dt></BookgDt>
    <NtryDtls><TxDtls><Refs><EndToEndId>X</EndToEndId></Refs></TxDtls></NtryDtls>
  </Ntry>
</Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;
    const { returns, warnings } = parseCamt054(noReturn);
    expect(returns).toHaveLength(0);
    expect(warnings.some((w) => w.includes("Rücklastschriften"))).toBe(true);
  });

  it("warns on a file without entries", () => {
    const { returns, warnings } = parseCamt054("<Document></Document>");
    expect(returns).toHaveLength(0);
    expect(warnings.some((w) => w.includes("Ntry"))).toBe(true);
  });
});

describe("matchCamtReturns", () => {
  const items: ReturnableItem[] = [
    { feeRunItemId: "item-1", endToEndId: "E2E-AAA-001", amount: "54.00", alreadyReturned: false },
    { feeRunItemId: "item-2", endToEndId: "E2E-BBB-002", amount: "12.50", alreadyReturned: true },
  ];

  const ret = (endToEndId: string | null): Camt054Return => ({
    endToEndId,
    amount: 1,
    currency: "EUR",
    reasonCode: null,
    reasonText: null,
    returnedOn: null,
    debtorName: null,
  });

  it("matches by EndToEndId and flags already-returned and unmatched", () => {
    const matches = matchCamtReturns(
      [ret("E2E-AAA-001"), ret("E2E-BBB-002"), ret("E2E-UNKNOWN"), ret(null)],
      items,
    );
    expect(matches[0]!.status).toBe("matched");
    expect(matches[0]!.item?.feeRunItemId).toBe("item-1");
    expect(matches[1]!.status).toBe("already_returned");
    expect(matches[2]!.status).toBe("unmatched");
    expect(matches[3]!.status).toBe("unmatched");
  });

  it("consumes each item at most once", () => {
    const matches = matchCamtReturns([ret("E2E-AAA-001"), ret("E2E-AAA-001")], items);
    expect(matches[0]!.status).toBe("matched");
    expect(matches[1]!.status).toBe("unmatched");
  });
});
