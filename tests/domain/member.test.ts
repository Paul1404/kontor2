import { describe, expect, it } from "vitest";
import {
  ageAt,
  type CleanMemberInput,
  deriveCleanColumns,
  deriveStatus,
  isActiveStatus,
  isDunningBlocked,
  isMinorAt,
  memberDisplayName,
  memberRef,
  toMemberView,
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
  it("prefers the Mitgliedsnummer, falls back to A+adrNr", () => {
    expect(memberRef({ mitgliedsnummer: "M-7", adrNr: 42 })).toBe("M-7");
    expect(memberRef({ mitglnr: "M-7", adrNr: 42 })).toBe("M-7");
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
    ).toBe("Mitglied 9");
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

describe("deriveCleanColumns", () => {
  const base = {
    mitglnr: null,
    eMailName: null,
    telefon3: null,
    aktivPasiv: null,
    austritt: null,
    verstorbenAm: null,
    mahnSperre: null,
  };

  it("derives all four clean columns from legacy fields", () => {
    expect(
      deriveCleanColumns({
        ...base,
        mitglnr: " M-9 ",
        eMailName: "a@b.de",
        aktivPasiv: "P",
        mahnSperre: "gesperrt",
      }),
    ).toEqual({
      mitgliedsnummer: "M-9",
      email: "a@b.de",
      status: "passiv",
      dunningBlocked: true,
    });
  });

  it("keeps the telefon3 email fallback and trims empties to null", () => {
    expect(deriveCleanColumns({ ...base, eMailName: "  ", telefon3: "old@example.com" })).toEqual({
      mitgliedsnummer: null,
      email: "old@example.com",
      status: "aktiv",
      dunningBlocked: false,
    });
  });

  it("ranks death over exit for the derived status", () => {
    expect(
      deriveCleanColumns({ ...base, austritt: new Date(), verstorbenAm: new Date() }).status,
    ).toBe("verstorben");
    expect(deriveCleanColumns({ ...base, austritt: new Date() }).status).toBe("ausgetreten");
  });
});

describe("toMemberView", () => {
  const base: CleanMemberInput = {
    adrNr: 42,
    mitgliedsnummer: "M-0042",
    anrede: "Frau",
    titel1: null,
    titel2: null,
    vorname: "Anna",
    nachname: "Beispiel",
    geborene: null,
    geburtsname: null,
    genannt: null,
    namensvorsatz: null,
    namenszusatz: null,
    geburtsdatum: new Date(Date.UTC(1990, 4, 12)),
    geburtsort: null,
    strasse: "Hauptstr.",
    hausnummer: "12a",
    adresszusatz: null,
    plz: "97520",
    ort: "Untereuerheim",
    land: "DE",
    email: "anna@example.com",
    telefon1: null,
    telefon2: null,
    telefon3: null,
    www: null,
    fax: null,
    firma1: null,
    firma2: null,
    firma3: null,
    firma4: null,
    kurzname: null,
    funktion: null,
    abteilung: null,
    spender: null,
    status: "aktiv",
    dunningBlocked: false,
    eintritt: new Date(Date.UTC(2010, 0, 1)),
    austritt: null,
    verstorbenAm: null,
    isDeleted: false,
    iban1: "DE89370400440532013000",
    iban1Last4: "3000",
    bic1: "COBADEFFXXX",
    mandatsreferenz: "MAN-001",
    abwKontoInh: null,
    strasseKih: null,
    plzKih: null,
    ortKih: null,
    emailKih: null,
    adrNrKih: null,
  };

  it("projects a clean row to the API shape", () => {
    const view = toMemberView({ ...base, id: "uuid-1", deletedAt: null });
    expect(view.memberRef).toBe("M-0042");
    expect(view.displayName).toBe("Anna Beispiel");
    expect(view.isActive).toBe(true);
    expect(view.geburtsdatum).toBe("1990-05-12");
    expect(view.eintritt).toBe("2010-01-01");
    expect(view.iban1Last4).toBe("3000");
    // No raw IBAN leaks into the view.
    expect(view).not.toHaveProperty("iban1");
  });

  it("is not active when soft-deleted or exited", () => {
    expect(toMemberView({ ...base, id: "x", deletedAt: new Date() }).isActive).toBe(false);
    expect(
      toMemberView({ ...base, status: "ausgetreten", id: "x", deletedAt: null }).isActive,
    ).toBe(false);
  });
});
