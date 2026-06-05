import { describe, expect, it } from "vitest";
import {
  ageAt,
  isMinorAt,
  type MemberWithDebt,
  mahngebuhrFor,
  planNichtEingezogen,
  resolveRecipient,
  sumDecimal,
} from "~/server/dunning/build-dunning";

function makeMember(overrides: Partial<MemberWithDebt> = {}): MemberWithDebt {
  return {
    memberId: "m1",
    mitglnr: "100",
    adrNr: 1,
    vorname: "Max",
    nachname: "Muster",
    kurzname: null,
    firma1: null,
    anrede: "Herr",
    strasse: "Hauptstr.",
    hausnummer: "1",
    plz: "97447",
    ort: "Untereuerheim",
    eMailName: null,
    dunningBlocked: false,
    geburtsdatum: null,
    vertreterAnrede: null,
    vertreterName: null,
    vertreterStrasse: null,
    vertreterHausnummer: null,
    vertreterPlz: null,
    vertreterOrt: null,
    currentMahnstufe: 0,
    postings: [],
    openSum: "0",
    daysOverdueMax: 0,
    ...overrides,
  };
}

describe("sumDecimal", () => {
  it("adds in integer cents to avoid float drift", () => {
    expect(sumDecimal(["0.10", "0.20"])).toBe("0.30");
    expect(sumDecimal(["10.00", "5.00", "2.50"])).toBe("17.50");
  });

  it("handles single value", () => {
    expect(sumDecimal(["12.34"])).toBe("12.34");
  });

  it("handles empty list", () => {
    expect(sumDecimal([])).toBe("0.00");
  });

  it("survives 0.1 + 0.2 without binary float artefacts", () => {
    expect(sumDecimal(["0.1", "0.2"])).toBe("0.30");
    // 100 increments of one cent: would drift in plain float arithmetic
    expect(sumDecimal(Array.from({ length: 100 }, () => "0.01"))).toBe("1.00");
  });
});

describe("mahngebuhrFor", () => {
  const org = { mahngebuhr1: "0", mahngebuhr2: "5", mahngebuhr3: "10" };

  it("returns the configured fee per level", () => {
    expect(mahngebuhrFor(1, org)).toBe("0");
    expect(mahngebuhrFor(2, org)).toBe("5");
    expect(mahngebuhrFor(3, org)).toBe("10");
  });

  it("clamps unexpected levels to nearest", () => {
    expect(mahngebuhrFor(0, org)).toBe("0");
    expect(mahngebuhrFor(4, org)).toBe("10");
  });
});

describe("planNichtEingezogen", () => {
  it("reopens an eingezogen posting back to open with the full amount", () => {
    expect(planNichtEingezogen({ status: "eingezogen", amount: "42.50" })).toEqual({
      status: "open",
      paidAmount: "0",
      openAmount: "42.50",
      mahnstufe: 0,
    });
  });

  it("leaves non-eingezogen postings untouched", () => {
    for (const status of ["open", "returned", "paid", "cancelled"]) {
      expect(planNichtEingezogen({ status, amount: "10.00" })).toBeNull();
    }
  });
});

describe("ageAt / isMinorAt", () => {
  const asOf = new Date(Date.UTC(2026, 5, 1)); // 2026-06-01

  it("computes whole-year age and respects the birthday", () => {
    expect(ageAt("2008-06-01", asOf)).toBe(18); // birthday reached
    expect(ageAt("2008-06-02", asOf)).toBe(17); // birthday tomorrow
    expect(ageAt(new Date(Date.UTC(2000, 0, 1)), asOf)).toBe(26);
  });

  it("returns null for missing or invalid dates", () => {
    expect(ageAt(null, asOf)).toBeNull();
    expect(ageAt("not-a-date", asOf)).toBeNull();
  });

  it("treats turning 18 on the run date as an adult", () => {
    expect(isMinorAt("2008-06-01", asOf)).toBe(false);
    expect(isMinorAt("2008-06-02", asOf)).toBe(true);
    expect(isMinorAt(null, asOf)).toBe(false); // unknown age is not a minor
  });
});

describe("resolveRecipient", () => {
  const asOf = new Date(Date.UTC(2026, 5, 1));
  const minorBirth = "2012-01-01"; // 14 years old

  it("addresses adults directly", () => {
    const r = resolveRecipient(makeMember({ geburtsdatum: "1990-01-01" }), null, asOf);
    expect(r.isMinor).toBe(false);
    expect(r.guardianSource).toBeNull();
    expect(r.recipient.name).toBe("Max Muster");
    expect(r.vertretungFor).toBeNull();
  });

  it("prefers a flagged connection for minors and falls back to the member address", () => {
    const r = resolveRecipient(
      makeMember({ geburtsdatum: minorBirth }),
      {
        anrede: "Frau",
        name: "Erika Muster",
        strasse: null,
        hausnummer: null,
        plz: null,
        ort: null,
      },
      asOf,
    );
    expect(r.guardianSource).toBe("connection");
    expect(r.recipient.name).toBe("Erika Muster");
    expect(r.recipient.ort).toBe("Untereuerheim"); // inherited from the minor
    expect(r.vertretungFor).toBe("Max Muster");
    expect(r.minorWithoutGuardian).toBe(false);
  });

  it("uses custom Vertreter fields when no connection is flagged", () => {
    const r = resolveRecipient(
      makeMember({
        geburtsdatum: minorBirth,
        vertreterName: "Hans Vormund",
        vertreterStrasse: "Nebenweg",
        vertreterPlz: "97000",
        vertreterOrt: "Schweinfurt",
      }),
      null,
      asOf,
    );
    expect(r.guardianSource).toBe("custom");
    expect(r.recipient.name).toBe("Hans Vormund");
    expect(r.recipient.ort).toBe("Schweinfurt"); // its own address wins
  });

  it("flags minors with no guardian and still addresses the member", () => {
    const r = resolveRecipient(makeMember({ geburtsdatum: minorBirth }), null, asOf);
    expect(r.isMinor).toBe(true);
    expect(r.guardianSource).toBeNull();
    expect(r.minorWithoutGuardian).toBe(true);
    expect(r.recipient.name).toBe("Max Muster");
  });

  describe("recipientEmail", () => {
    it("uses the member's own email for adults", () => {
      const r = resolveRecipient(
        makeMember({ geburtsdatum: "1990-01-01", eMailName: "max@example.org" }),
        null,
        asOf,
      );
      expect(r.recipientEmail).toBe("max@example.org");
    });

    it("prefers the guardian connection's email for minors", () => {
      const r = resolveRecipient(
        makeMember({ geburtsdatum: minorBirth, eMailName: "kid@example.org" }),
        {
          anrede: "Frau",
          name: "Erika Muster",
          strasse: null,
          hausnummer: null,
          plz: null,
          ort: null,
          email: "erika@example.org",
        },
        asOf,
      );
      expect(r.recipientEmail).toBe("erika@example.org");
    });

    it("falls back to the member's email when the guardian has none", () => {
      const r = resolveRecipient(
        makeMember({ geburtsdatum: minorBirth, eMailName: "kid@example.org" }),
        {
          anrede: "Frau",
          name: "Erika Muster",
          strasse: null,
          hausnummer: null,
          plz: null,
          ort: null,
          email: null,
        },
        asOf,
      );
      expect(r.recipientEmail).toBe("kid@example.org");
    });

    it("returns null when neither has an email", () => {
      const r = resolveRecipient(makeMember({ geburtsdatum: minorBirth }), null, asOf);
      expect(r.recipientEmail).toBeNull();
    });
  });
});
