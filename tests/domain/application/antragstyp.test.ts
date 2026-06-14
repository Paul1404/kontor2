import { describe, expect, it } from "vitest";
import {
  ageAt,
  categoryFromAge,
  DEFAULT_ALTERSGRENZEN,
  detectAntragstyp,
  mitgliedschaftTypFor,
  parseISODate,
  realAge,
  stichtag,
} from "~/server/domain/application/antragstyp";

describe("parseISODate", () => {
  it("parses a YYYY-MM-DD string as a UTC date", () => {
    const d = parseISODate("2010-03-14");
    expect(d.getUTCFullYear()).toBe(2010);
    expect(d.getUTCMonth()).toBe(2);
    expect(d.getUTCDate()).toBe(14);
  });

  it("returns an invalid date for garbage", () => {
    expect(Number.isNaN(parseISODate("nope").getTime())).toBe(true);
  });
});

describe("ageAt", () => {
  it("does not count a birthday that has not happened yet", () => {
    // Born Dec 31, measured Jan 1 the next year: just turned... not yet.
    expect(ageAt(parseISODate("2000-12-31"), parseISODate("2018-12-30"))).toBe(17);
    expect(ageAt(parseISODate("2000-12-31"), parseISODate("2018-12-31"))).toBe(18);
  });
});

describe("categoryFromAge (Stichtag = Jan 1)", () => {
  const ref2026 = stichtag(2026);
  const g = DEFAULT_ALTERSGRENZEN;
  it("maps the age buckets with the default 14/18/25 boundaries", () => {
    expect(ageAt(parseISODate("2013-06-01"), ref2026)).toBe(12); // < 14 -> kind
    expect(categoryFromAge(parseISODate("2013-06-01"), g)).toBe("kind");
    expect(categoryFromAge(parseISODate("2010-06-01"), g)).toBe("jugendlich"); // 15
    expect(categoryFromAge(parseISODate("2004-06-01"), g)).toBe("junger_erwachsener"); // 21
    expect(categoryFromAge(parseISODate("1990-06-01"), g)).toBe("erwachsener"); // 35
  });

  it("honours custom boundaries", () => {
    // A club whose Jugendtarif runs to 21: a 19-year-old is jugendlich, not jung.
    const custom = { kindMax: 14, jugendlichMax: 21, jungerErwachsenerMax: 27 };
    expect(categoryFromAge(parseISODate("2006-06-01"), custom)).toBe("jugendlich"); // age 19
    expect(categoryFromAge(parseISODate("2006-06-01"), g)).toBe("junger_erwachsener"); // default
  });

  it("short-circuits to familie", () => {
    expect(categoryFromAge(parseISODate("1990-01-01"), g, true)).toBe("familie");
  });
});

describe("detectAntragstyp", () => {
  const today = parseISODate("2026-01-15");

  it("classifies a minor as kind regardless of children/partner", () => {
    expect(
      detectAntragstyp({
        geburtsdatum: parseISODate("2015-01-01"),
        hasChildren: false,
        hasPartner: false,
        today,
      }),
    ).toBe("kind");
  });

  it("classifies an adult with children and a partner as familie", () => {
    expect(
      detectAntragstyp({
        geburtsdatum: parseISODate("1985-01-01"),
        hasChildren: true,
        hasPartner: true,
        today,
      }),
    ).toBe("familie");
  });

  it("an adult with children but no partner stays einzel", () => {
    expect(
      detectAntragstyp({
        geburtsdatum: parseISODate("1985-01-01"),
        hasChildren: true,
        hasPartner: false,
        today,
      }),
    ).toBe("einzel");
  });

  it("a plain adult is einzel", () => {
    expect(
      detectAntragstyp({
        geburtsdatum: parseISODate("1985-01-01"),
        hasChildren: false,
        hasPartner: false,
        today,
      }),
    ).toBe("einzel");
  });
});

describe("mitgliedschaftTypFor", () => {
  it("familie wins over age", () => {
    expect(mitgliedschaftTypFor("familie", parseISODate("1985-01-01"), DEFAULT_ALTERSGRENZEN)).toBe(
      "familie",
    );
  });
  it("derives the category for non-family types", () => {
    expect(mitgliedschaftTypFor("einzel", parseISODate("1985-01-01"), DEFAULT_ALTERSGRENZEN)).toBe(
      "erwachsener",
    );
  });
});

describe("realAge", () => {
  it("computes age as of today", () => {
    expect(realAge(parseISODate("2000-01-01"), parseISODate("2026-01-01"))).toBe(26);
    expect(realAge(parseISODate("2000-06-01"), parseISODate("2026-01-01"))).toBe(25);
  });
});
