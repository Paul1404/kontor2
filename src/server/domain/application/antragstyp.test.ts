import { describe, expect, it } from "vitest";
import {
  ageAt,
  categoryFromAge,
  detectAntragstyp,
  mitgliedschaftTypFor,
  parseISODate,
  realAge,
  stichtag,
} from "./antragstyp";

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
  it("maps the age buckets", () => {
    // Use ageAt against the Stichtag to express the boundaries clearly.
    expect(ageAt(parseISODate("2013-06-01"), ref2026)).toBe(12); // < 14 -> kind
    expect(ageAt(parseISODate("2010-06-01"), ref2026)).toBe(15); // < 18 -> jugendlich
    expect(ageAt(parseISODate("2004-06-01"), ref2026)).toBe(21); // < 25 -> jung
    expect(ageAt(parseISODate("1990-06-01"), ref2026)).toBe(35); // >= 25 -> erwachsen
  });

  it("short-circuits to familie", () => {
    expect(categoryFromAge(parseISODate("1990-01-01"), true)).toBe("familie");
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
    expect(mitgliedschaftTypFor("familie", parseISODate("1985-01-01"))).toBe("familie");
  });
  it("derives the category for non-family types", () => {
    expect(mitgliedschaftTypFor("einzel", parseISODate("1985-01-01"))).toBe("erwachsener");
  });
});

describe("realAge", () => {
  it("computes age as of today", () => {
    expect(realAge(parseISODate("2000-01-01"), parseISODate("2026-01-01"))).toBe(26);
    expect(realAge(parseISODate("2000-06-01"), parseISODate("2026-01-01"))).toBe(25);
  });
});
