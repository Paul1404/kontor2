import { describe, expect, it } from "vitest";
import {
  mapSvumsApplication,
  normalizeBeitrag,
  parseSvumsExport,
  parseSvumsTimestamp,
  type SvumsApplication,
  splitStrasse,
  svumsDedupeKey,
} from "~/server/domain/application/svums-import";

const ABT = new Map([
  ["fußball", "abt-fussball"],
  ["turnen", "abt-turnen"],
]);

function baseItem(overrides: Partial<SvumsApplication> = {}): SvumsApplication {
  return {
    id: 42,
    antragsnummer: "ANT-2024-0007",
    antragstyp: "einzel",
    geschlecht: "Frau",
    vorname: "Erika",
    nachname: "Muster",
    geburtsdatum: "1990-04-12",
    strasse: "Musterweg 3a",
    plz: "97508",
    ort: "Grettstadt",
    telefon: "0151 1234567",
    email: "erika@example.com",
    erziehungsberechtigter_vorname: null,
    erziehungsberechtigter_nachname: null,
    partner_vorname: null,
    partner_nachname: null,
    partner_geburtsdatum: null,
    partner_abteilungen: null,
    kinder: null,
    abteilungen: ["Fußball"],
    mitgliedschaft_typ: "erwachsener",
    elternteil_mitglied: false,
    jahresbeitrag: "54.00",
    kontoinhaber: "Erika Muster",
    iban: "DE02120300000000202051",
    bic: "BYLADEM1001",
    kreditinstitut: "Deutsche Kreditbank",
    mandatsreferenz: "SVU-2024-0007",
    status: "genehmigt",
    notes: "Alte Notiz",
    admin_decline_reason: null,
    mitgliedsnummer: "123456",
    consent_at: "2024-05-03T14:23:11.123456",
    datenschutz_accepted: true,
    satzung_accepted: true,
    consent_ip: "203.0.113.7",
    email_sent: true,
    is_test: false,
    source: "online",
    created_at: "2024-05-03T14:23:11.123456",
    ...overrides,
  };
}

describe("parseSvumsExport", () => {
  it("accepts the paginated envelope from /api/admin/applications", () => {
    const { items, errors } = parseSvumsExport(
      JSON.stringify({ items: [baseItem()], total: 1, page: 1, per_page: 25 }),
    );
    expect(items).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it("accepts a bare array", () => {
    const { items } = parseSvumsExport(JSON.stringify([baseItem(), baseItem({ id: 43 })]));
    expect(items).toHaveLength(2);
  });

  it("reports invalid rows instead of failing the whole file", () => {
    const { items, errors } = parseSvumsExport(
      JSON.stringify([baseItem(), { id: 1, vorname: "kaputt" }]),
    );
    expect(items).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Eintrag 2");
  });

  it("throws on non-JSON and on unexpected shapes", () => {
    expect(() => parseSvumsExport("not json")).toThrow(/JSON/);
    expect(() => parseSvumsExport(JSON.stringify({ foo: 1 }))).toThrow(/Format/);
  });
});

describe("splitStrasse", () => {
  it("splits a trailing house number off", () => {
    expect(splitStrasse("Musterweg 3a")).toEqual({ strasse: "Musterweg", hausnummer: "3a" });
    expect(splitStrasse("Hauptstraße 12")).toEqual({ strasse: "Hauptstraße", hausnummer: "12" });
    expect(splitStrasse("Am Berg 4-6")).toEqual({ strasse: "Am Berg", hausnummer: "4-6" });
  });

  it("keeps everything in strasse when no number is found", () => {
    expect(splitStrasse("Postfach")).toEqual({ strasse: "Postfach", hausnummer: null });
    expect(splitStrasse(null)).toEqual({ strasse: null, hausnummer: null });
    expect(splitStrasse("  ")).toEqual({ strasse: null, hausnummer: null });
  });
});

describe("parseSvumsTimestamp", () => {
  it("treats suffix-less timestamps as UTC (svums uses datetime.utcnow)", () => {
    const d = parseSvumsTimestamp("2024-05-03T14:23:11");
    expect(d?.toISOString()).toBe("2024-05-03T14:23:11.000Z");
  });

  it("keeps an explicit timezone", () => {
    const d = parseSvumsTimestamp("2024-05-03T14:23:11Z");
    expect(d?.toISOString()).toBe("2024-05-03T14:23:11.000Z");
  });

  it("returns null for empty or invalid values", () => {
    expect(parseSvumsTimestamp(null)).toBeNull();
    expect(parseSvumsTimestamp("kaputt")).toBeNull();
  });
});

describe("normalizeBeitrag", () => {
  it("normalizes strings and numbers to a 2-decimal string", () => {
    expect(normalizeBeitrag("54.00")).toBe("54.00");
    expect(normalizeBeitrag("27,5")).toBe("27.50");
    expect(normalizeBeitrag(86)).toBe("86.00");
  });

  it("returns null for missing or unreadable values", () => {
    expect(normalizeBeitrag(null)).toBeNull();
    expect(normalizeBeitrag("")).toBeNull();
    expect(normalizeBeitrag("abc")).toBeNull();
  });
});

describe("mapSvumsApplication", () => {
  const opts = { abteilungIdByName: ABT, importedAt: new Date("2026-06-10T10:00:00Z") };

  it("maps a full application", () => {
    const { values, originalAntragsnummer, warnings } = mapSvumsApplication(baseItem(), opts);
    expect(originalAntragsnummer).toBe("ANT-2024-0007");
    expect(warnings).toHaveLength(0);
    expect(values.status).toBe("genehmigt");
    expect(values.source).toBe("online");
    expect(values.geschlecht).toBe("w");
    expect(values.strasse).toBe("Musterweg");
    expect(values.hausnummer).toBe("3a");
    expect(values.abteilungen).toEqual(["abt-fussball"]);
    expect(values.jahresbeitrag).toBe("54.00");
    expect(values.iban).toBe("DE02120300000000202051");
    expect(values.mitgliedsnummer).toBe("123456");
    expect(values.geburtsdatum.toISOString().slice(0, 10)).toBe("1990-04-12");
    expect(values.createdAt.toISOString()).toBe("2024-05-03T14:23:11.123Z");
    expect(values.notes).toContain("Alte Notiz");
    expect(values.notes).toContain("Importiert aus SVUMS (Antrag ANT-2024-0007)");
  });

  it("maps family applications including partner and kinder Abteilungen", () => {
    const { values } = mapSvumsApplication(
      baseItem({
        antragstyp: "familie",
        mitgliedschaft_typ: "familie",
        partner_vorname: "Max",
        partner_nachname: "Muster",
        partner_geburtsdatum: "1988-01-30",
        partner_abteilungen: ["Turnen"],
        kinder: [
          {
            vorname: "Kim",
            nachname: "Muster",
            geburtsdatum: "2018-01-14",
            abteilungen: ["Turnen"],
          },
        ],
      }),
      opts,
    );
    expect(values.partnerVorname).toBe("Max");
    expect(values.partnerGeburtsdatum?.toISOString().slice(0, 10)).toBe("1988-01-30");
    expect(values.partnerAbteilungen).toEqual(["abt-turnen"]);
    expect(values.kinder).toEqual([
      {
        vorname: "Kim",
        nachname: "Muster",
        geburtsdatum: "2018-01-14",
        abteilungen: ["abt-turnen"],
      },
    ]);
  });

  it("drops unmatched Abteilungen into the note and warns", () => {
    const { values, warnings } = mapSvumsApplication(
      baseItem({ abteilungen: ["Fußball", "Schach"] }),
      opts,
    );
    expect(values.abteilungen).toEqual(["abt-fussball"]);
    expect(values.notes).toContain("Nicht zugeordnete Abteilungen: Schach.");
    expect(warnings.some((w) => w.includes("Schach"))).toBe(true);
  });

  it("rejects an invalid IBAN with a warning instead of failing the row", () => {
    const { values, warnings } = mapSvumsApplication(
      baseItem({ iban: "[ENTSCHLÜSSELUNG FEHLGESCHLAGEN]" }),
      opts,
    );
    expect(values.iban).toBeNull();
    expect(warnings.some((w) => w.includes("IBAN"))).toBe(true);
  });

  it("falls back to derived values for unknown status and Mitgliedschaftstyp", () => {
    const { values, warnings } = mapSvumsApplication(
      baseItem({ status: "uralt", mitgliedschaft_typ: "komisch" }),
      opts,
    );
    expect(values.status).toBe("neu");
    expect(values.mitgliedschaftTyp).toBe("erwachsener");
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("throws on an unparseable Geburtsdatum or Eingangsdatum", () => {
    expect(() => mapSvumsApplication(baseItem({ geburtsdatum: "kaputt" }), opts)).toThrow(
      /Geburtsdatum/,
    );
    expect(() => mapSvumsApplication(baseItem({ created_at: "kaputt" }), opts)).toThrow(
      /Eingangsdatum/,
    );
  });
});

describe("svumsDedupeKey", () => {
  it("is stable across re-imports and case-insensitive on names", () => {
    const a = mapSvumsApplication(baseItem(), {
      abteilungIdByName: ABT,
      importedAt: new Date(),
    }).values;
    const b = mapSvumsApplication(baseItem({ vorname: "ERIKA" }), {
      abteilungIdByName: ABT,
      importedAt: new Date(),
    }).values;
    expect(svumsDedupeKey(a)).toBe(svumsDedupeKey(b));
  });

  it("distinguishes rows created at different times", () => {
    const a = mapSvumsApplication(baseItem(), {
      abteilungIdByName: ABT,
      importedAt: new Date(),
    }).values;
    const b = mapSvumsApplication(baseItem({ created_at: "2024-05-03T14:23:12" }), {
      abteilungIdByName: ABT,
      importedAt: new Date(),
    }).values;
    expect(svumsDedupeKey(a)).not.toBe(svumsDedupeKey(b));
  });
});
