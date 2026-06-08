import { describe, expect, it } from "vitest";
import {
  ageAt,
  deriveStatus,
  isActiveStatus,
  isDunningBlocked,
  isMinorAt,
  memberDisplayName,
  memberRef,
  yesNoToBool,
} from "~/server/domain/member";

describe("yesNoToBool", () => {
  it("reads Linear's loose yes/no codes", () => {
    for (const v of ["J", "Y", "1", " j "]) expect(yesNoToBool(v)).toBe(true);
    for (const v of ["N", "0", ""]) expect(yesNoToBool(v)).toBe(false);
    expect(yesNoToBool(null)).toBeNull();
    expect(yesNoToBool(undefined)).toBeNull();
    expect(yesNoToBool(true)).toBe(true);
    expect(yesNoToBool("vielleicht")).toBeNull();
  });
});

describe("isDunningBlocked", () => {
  it("treats empty / '0' / whitespace as not blocked", () => {
    expect(isDunningBlocked(null)).toBe(false);
    expect(isDunningBlocked(undefined)).toBe(false);
    expect(isDunningBlocked("")).toBe(false);
    expect(isDunningBlocked("0")).toBe(false);
    expect(isDunningBlocked(" 0 ")).toBe(false);
  });
  it("treats any other value as blocked", () => {
    expect(isDunningBlocked("1")).toBe(true);
    expect(isDunningBlocked("J")).toBe(true);
    expect(isDunningBlocked("gesperrt")).toBe(true);
  });
});

describe("ageAt / isMinorAt", () => {
  const asOf = new Date(Date.UTC(2026, 5, 1));
  it("computes whole years at the cutoff", () => {
    expect(ageAt("2008-06-01", asOf)).toBe(18);
    expect(ageAt("2008-06-02", asOf)).toBe(17);
    expect(ageAt(null, asOf)).toBeNull();
    expect(ageAt("not-a-date", asOf)).toBeNull();
  });
  it("treats unknown birthdate as not a minor", () => {
    expect(isMinorAt("2008-06-02", asOf)).toBe(true);
    expect(isMinorAt("2008-06-01", asOf)).toBe(false);
    expect(isMinorAt(null, asOf)).toBe(false);
  });
});

describe("memberRef", () => {
  it("prefers the app-owned member number over everything else", () => {
    expect(
      memberRef({ memberNo: "M-AB1234", kontaktNo: null, mitgliedsnummer: "100", adrNr: 42 }),
    ).toBe("M-AB1234");
  });
  it("uses the contact number for non-members", () => {
    expect(
      memberRef({ memberNo: null, kontaktNo: "K-CD5678", mitgliedsnummer: null, adrNr: 42 }),
    ).toBe("K-CD5678");
  });
  it("falls back to the preserved legacy number, then A+adrNr", () => {
    expect(memberRef({ mitgliedsnummer: "100", adrNr: 42 })).toBe("100");
    expect(memberRef({ mitgliedsnummer: "  ", adrNr: 42 })).toBe("A42");
    expect(memberRef({ mitgliedsnummer: null, adrNr: 42 })).toBe("A42");
  });
});

describe("memberDisplayName", () => {
  it("uses full name, then Kurzname, then Firma, then a numeric ref", () => {
    expect(
      memberDisplayName({ vorname: "Anna", nachname: "Beispiel", kurzname: null, firma1: null }),
    ).toBe("Anna Beispiel");
    expect(
      memberDisplayName({ vorname: null, nachname: null, kurzname: "AB", firma1: "ACME" }),
    ).toBe("AB");
    expect(
      memberDisplayName({ vorname: null, nachname: null, kurzname: null, firma1: "ACME" }),
    ).toBe("ACME");
    expect(
      memberDisplayName({ vorname: null, nachname: null, kurzname: null, firma1: null, adrNr: 9 }),
    ).toBe("Mitglied A9");
    expect(
      memberDisplayName({
        vorname: null,
        nachname: null,
        kurzname: null,
        firma1: null,
        memberNo: "M-AB1234",
      }),
    ).toBe("Mitglied M-AB1234");
  });
});

describe("deriveStatus", () => {
  it("ranks death over exit over the active/passive flag", () => {
    expect(deriveStatus({ austritt: new Date(), verstorbenAm: new Date(), aktivPasiv: "A" })).toBe(
      "verstorben",
    );
    expect(deriveStatus({ austritt: new Date(), verstorbenAm: null, aktivPasiv: "A" })).toBe(
      "ausgetreten",
    );
    expect(deriveStatus({ austritt: null, verstorbenAm: null, aktivPasiv: "P" })).toBe("passiv");
    expect(deriveStatus({ austritt: null, verstorbenAm: null, aktivPasiv: "A" })).toBe("aktiv");
    expect(deriveStatus({ austritt: null, verstorbenAm: null, aktivPasiv: null })).toBe("aktiv");
  });
  it("isActiveStatus is true only for aktiv/passiv", () => {
    expect(isActiveStatus("aktiv")).toBe(true);
    expect(isActiveStatus("passiv")).toBe(true);
    expect(isActiveStatus("ausgetreten")).toBe(false);
    expect(isActiveStatus("verstorben")).toBe(false);
  });
});
