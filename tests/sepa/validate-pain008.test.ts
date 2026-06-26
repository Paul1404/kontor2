import { describe, expect, it } from "vitest";
import { isValidCreditorId, validatePain008 } from "~/server/sepa/validate-pain008";

const TODAY = "2026-06-26";

const VALID = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>TEST-1</MsgId>
      <CreDtTm>2026-06-26T10:00:00</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>36.00</CtrlSum>
      <InitgPty><Nm>Sportverein</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>TEST-1-RCUR</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>36.00</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm><SeqTp>RCUR</SeqTp></PmtTpInf>
      <ReqdColltnDt>2026-06-30</ReqdColltnDt>
      <Cdtr><Nm>Sportverein 1945 Untereuerheim e.V.</Nm></Cdtr>
      <CdtrAcct><Id><IBAN>DE56793501010005124185</IBAN></Id></CdtrAcct>
      <CdtrAgt><FinInstnId><BIC>BYLADEM1KSW</BIC></FinInstnId></CdtrAgt>
      <CdtrSchmeId><Id><PrvtId><Othr><Id>DE71ZZZ00000901082</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>
      <DrctDbtTxInf>
        <PmtId><EndToEndId>E2E1</EndToEndId></PmtId>
        <InstdAmt Ccy="EUR">36.00</InstdAmt>
        <DrctDbtTx><MndtRltdInf><MndtId>21612821</MndtId><DtOfSgntr>2013-03-07</DtOfSgntr></MndtRltdInf></DrctDbtTx>
        <DbtrAgt><FinInstnId><BIC>BYLADEM1KSW</BIC></FinInstnId></DbtrAgt>
        <Dbtr><Nm>Leonie Holzheimer</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>DE12793501010000622431</IBAN></Id></DbtrAcct>
        <RmtInf><Ustrd>Mitgliedsbeitrag 2026</Ustrd></RmtInf>
      </DrctDbtTxInf>
    </PmtInf>
  </CstmrDrctDbtInitn>
</Document>`;

const codes = (xml: string) => validatePain008(xml, TODAY).findings.map((f) => f.code);

describe("validatePain008", () => {
  it("accepts a well-formed file", () => {
    const r = validatePain008(VALID, TODAY);
    expect(r.ok).toBe(true);
    expect(r.counts.errors).toBe(0);
    expect(r.summary.computedCount).toBe(1);
    expect(r.summary.computedSum).toBe("36.00");
    expect(r.summary.creditorId).toBe("DE71ZZZ00000901082");
    expect(r.transactions[0]?.amount).toBe("36.00");
    expect(r.transactions[0]?.debtorName).toBe("Leonie Holzheimer");
  });

  it("flags a wrong group control sum", () => {
    const bad = VALID.replace("<CtrlSum>36.00</CtrlSum>", "<CtrlSum>99.00</CtrlSum>");
    const r = validatePain008(bad, TODAY);
    expect(r.ok).toBe(false);
    expect(codes(bad)).toContain("GRP_SUM");
  });

  it("flags a future mandate date", () => {
    const bad = VALID.replace("2013-03-07", "2027-01-01");
    expect(codes(bad)).toContain("SGNTR_FUTURE");
    expect(validatePain008(bad, TODAY).ok).toBe(false);
  });

  it("flags an invalid debtor IBAN", () => {
    const bad = VALID.replace("DE12793501010000622431", "DE12793501010000620000");
    expect(codes(bad)).toContain("DBTR_IBAN");
  });

  it("flags a collection date in the past", () => {
    const bad = VALID.replace("2026-06-30", "2026-06-01");
    expect(codes(bad)).toContain("COLLTN_PAST");
  });

  it("rejects non-pain.008 input", () => {
    const r = validatePain008("<foo>bar</foo>", TODAY);
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("FORMAT");
  });

  it("accepts IBAN-only debtor (NOTPROVIDED) as info, not error", () => {
    const bank = "<DbtrAgt><FinInstnId><BIC>BYLADEM1KSW</BIC></FinInstnId></DbtrAgt>";
    const ibanOnly =
      "<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>";
    const r = validatePain008(VALID.replace(bank, ibanOnly), TODAY);
    expect(r.ok).toBe(true);
    expect(r.findings.map((f) => f.code)).toContain("DBTR_IBAN_ONLY");
  });
});

describe("isValidCreditorId", () => {
  it("accepts a valid German creditor identifier", () => {
    expect(isValidCreditorId("DE71ZZZ00000901082")).toBe(true);
  });
  it("rejects a wrong check digit", () => {
    expect(isValidCreditorId("DE00ZZZ00000901082")).toBe(false);
  });
});
