import { describe, expect, it } from "vitest";
import {
  matchBankTransactions,
  type OpenPosting,
  parseBankCsv,
  parseGermanAmount,
} from "~/server/bank/reconcile";

describe("parseGermanAmount", () => {
  it("parses German decimal notation", () => {
    expect(parseGermanAmount("1.234,56")).toBeCloseTo(1234.56);
    expect(parseGermanAmount("-12,50")).toBeCloseTo(-12.5);
    expect(parseGermanAmount("42,00 €")).toBeCloseTo(42);
  });
  it("parses plain notation", () => {
    expect(parseGermanAmount("1234.56")).toBeCloseTo(1234.56);
    expect(parseGermanAmount("42")).toBeCloseTo(42);
  });
});

describe("parseBankCsv", () => {
  it("detects columns and parses credit rows", () => {
    const csv = [
      "Buchungstag;Name;Verwendungszweck;Betrag",
      "01.07.2026;Max Mustermann;Mitgliedsbeitrag M-000042;42,00",
      "02.07.2026;Edeka;Einkauf;-30,00",
    ].join("\n");
    const { rows, warnings } = parseBankCsv(csv);
    expect(warnings).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Max Mustermann", amount: 42 });
    expect(rows[1]?.amount).toBeCloseTo(-30);
  });

  it("warns when no amount column is present", () => {
    const { rows, warnings } = parseBankCsv("Datum;Text\n01.07.2026;irgendwas");
    expect(rows).toHaveLength(0);
    expect(warnings[0]).toContain("Betrags-Spalte");
  });
});

describe("matchBankTransactions", () => {
  const postings: OpenPosting[] = [
    {
      sollStellungId: "s1",
      memberId: "m1",
      reference: "M-000042",
      mitgliedsnummer: "42",
      nachname: "Mustermann",
      memberName: "Max Mustermann",
      billingYear: 2026,
      openAmount: 42,
    },
    {
      sollStellungId: "s2",
      memberId: "m2",
      reference: "M-000099",
      mitgliedsnummer: "99",
      nachname: "Schmidt",
      memberName: "Anna Schmidt",
      billingYear: 2026,
      openAmount: 60,
    },
  ];

  it("matches on reference and amount with high confidence", () => {
    const [p] = matchBankTransactions(
      [{ line: 2, date: null, amount: 42, name: "Max Mustermann", purpose: "Beitrag M-000042" }],
      postings,
    );
    expect(p?.confidence).toBe("high");
    expect(p?.posting?.sollStellungId).toBe("s1");
  });

  it("flags a name match with the wrong amount as medium", () => {
    const [p] = matchBankTransactions(
      [{ line: 2, date: null, amount: 30, name: "Anna Schmidt", purpose: "Beitrag" }],
      postings,
    );
    expect(p?.confidence).toBe("medium");
    expect(p?.posting?.sollStellungId).toBe("s2");
  });

  it("ignores debits and unmatched rows", () => {
    const res = matchBankTransactions(
      [
        { line: 2, date: null, amount: -10, name: "X", purpose: "Y" },
        { line: 3, date: null, amount: 5, name: "Unbekannt", purpose: "nichts" },
      ],
      postings,
    );
    expect(res[0]?.confidence).toBe("none");
    expect(res[1]?.posting).toBeNull();
  });

  it("does not assign the same posting to two transactions", () => {
    const res = matchBankTransactions(
      [
        { line: 2, date: null, amount: 42, name: "Max Mustermann", purpose: "M-000042" },
        { line: 3, date: null, amount: 42, name: "Max Mustermann", purpose: "M-000042" },
      ],
      postings,
    );
    expect(res[0]?.posting?.sollStellungId).toBe("s1");
    expect(res[1]?.posting).toBeNull();
  });
});
