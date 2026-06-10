import { describe, expect, it } from "vitest";
import {
  ageAt,
  deriveStatus,
  isActiveStatus,
  isDunningBlocked,
  isMinorAt,
  memberDisplayName,
  memberRef,
  pendingAustrittDate,
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
  it("ranks death over exit, otherwise the member is live", () => {
    expect(deriveStatus({ austritt: new Date(), verstorbenAm: new Date() })).toBe("verstorben");
    expect(deriveStatus({ austritt: new Date(), verstorbenAm: null })).toBe("ausgetreten");
    // aktiv/passiv is derived from Abteilungen on read, never stored here, so a
    // live member is always `aktiv`.
    expect(deriveStatus({ austritt: null, verstorbenAm: null })).toBe("aktiv");
  });
  it("isActiveStatus is true only for aktiv/passiv", () => {
    expect(isActiveStatus("aktiv")).toBe(true);
    expect(isActiveStatus("passiv")).toBe(true);
    expect(isActiveStatus("ausgetreten")).toBe(false);
    expect(isActiveStatus("verstorben")).toBe(false);
  });

  it("treats a future exit date as still active until it arrives", () => {
    const asOf = new Date("2026-06-09T12:00:00Z");
    const future = new Date("2026-12-31T00:00:00Z");
    const past = new Date("2026-01-01T00:00:00Z");

    // Notice given for year-end: still a member today.
    expect(deriveStatus({ austritt: future, verstorbenAm: null }, asOf)).toBe("aktiv");
    // The exit has come due.
    expect(deriveStatus({ austritt: past, verstorbenAm: null }, asOf)).toBe("ausgetreten");
    // The leave date itself counts as effective (first non-member day).
    expect(deriveStatus({ austritt: asOf, verstorbenAm: null }, asOf)).toBe("ausgetreten");
  });

  it("accepts YYYY-MM-DD strings for the exit date", () => {
    const asOf = new Date("2026-06-09T12:00:00Z");
    expect(deriveStatus({ austritt: "2026-12-31", verstorbenAm: null }, asOf)).toBe("aktiv");
    expect(deriveStatus({ austritt: "2026-01-01", verstorbenAm: null }, asOf)).toBe("ausgetreten");
  });
});

describe("pendingAustrittDate", () => {
  const asOf = new Date("2026-06-09T12:00:00Z");

  it("returns the leave date only when it is still in the future", () => {
    const future = new Date("2026-12-31T00:00:00Z");
    expect(pendingAustrittDate({ austritt: future, verstorbenAm: null }, asOf)).toEqual(future);
    expect(
      pendingAustrittDate({ austritt: new Date("2026-01-01T00:00:00Z"), verstorbenAm: null }, asOf),
    ).toBeNull();
    expect(pendingAustrittDate({ austritt: null, verstorbenAm: null }, asOf)).toBeNull();
  });

  it("clears the pending exit once a death is recorded", () => {
    const future = new Date("2026-12-31T00:00:00Z");
    expect(
      pendingAustrittDate({ austritt: future, verstorbenAm: new Date("2026-05-01") }, asOf),
    ).toBeNull();
  });
});
