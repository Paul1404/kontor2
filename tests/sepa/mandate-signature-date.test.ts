import { describe, expect, it } from "vitest";
import { mandateSignatureDate } from "~/server/sepa/select-mandate";

describe("mandateSignatureDate", () => {
  it("uses the signature date when present", () => {
    expect(
      mandateSignatureDate({
        unterschriftDatum: new Date("2019-07-04T00:00:00Z"),
        gueltigAb: new Date("2015-01-01T00:00:00Z"),
        angelegtAm: new Date("2026-05-29T00:00:00Z"),
      }),
    ).toBe("2019-07-04");
  });

  it("falls back to the mandate validity date when the signature date is missing (the Leonie case)", () => {
    expect(
      mandateSignatureDate({
        unterschriftDatum: null,
        gueltigAb: new Date("2013-03-07T00:00:00Z"),
        angelegtAm: new Date("2026-05-29T00:00:00Z"),
      }),
    ).toBe("2013-03-07");
  });

  it("falls back to angelegtAm when nothing else is set", () => {
    expect(
      mandateSignatureDate({
        unterschriftDatum: null,
        gueltigAb: null,
        angelegtAm: new Date("2020-03-26T00:00:00Z"),
      }),
    ).toBe("2020-03-26");
  });

  it("never produces a future date from a collection date (no falligkeit input at all)", () => {
    // The function has no access to the collection date by design, so it can
    // never emit a future DtOfSgntr like the old fallback did.
    const out = mandateSignatureDate({
      unterschriftDatum: null,
      gueltigAb: new Date("2010-01-01T00:00:00Z"),
      angelegtAm: new Date("2026-05-29T00:00:00Z"),
    });
    expect(out).toBe("2010-01-01");
  });
});
