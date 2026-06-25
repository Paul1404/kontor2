import { describe, expect, it } from "vitest";
import {
  DUPLICATE_SCORE_THRESHOLD,
  type DuplicateRow,
  scoreDuplicate,
} from "~/server/domain/member/duplicate-detection";

const baseRow: DuplicateRow = {
  id: "m1",
  vorname: "Peter",
  nachname: "Fischer",
  geburtsdatum: "1992-05-17",
  iban1: "DE35793501010008302671",
  iban1Last4: "2671",
  email: "fischerpeter1992@gmail.com",
  plz: "97469",
  ort: "Gochsheim",
  memberNo: "M-588M5D",
  kontaktNo: null,
  mitgliedsnummer: "1382",
};

describe("scoreDuplicate", () => {
  it("treats an identical IBAN as the strongest signal", () => {
    const r = scoreDuplicate(
      { vorname: "Pete", nachname: "Andere", iban: "DE35 7935 0101 0008 3026 71" },
      baseRow,
    );
    expect(r.score).toBeGreaterThanOrEqual(100);
    expect(r.reasons).toContain("gleiche IBAN");
  });

  it("scores name + matching date of birth high", () => {
    const r = scoreDuplicate(
      { vorname: "peter", nachname: "fischer", geburtsdatum: "1992-05-17" },
      baseRow,
    );
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.reasons).toContain("Name und Geburtsdatum");
  });

  it("flags name match when the stored DOB is the 01-01 placeholder (the Fischer case)", () => {
    const r = scoreDuplicate(
      { vorname: "Peter", nachname: "Fischer", geburtsdatum: "1992-05-17" },
      { ...baseRow, iban1: null, iban1Last4: null, email: null, geburtsdatum: "1995-01-01" },
    );
    expect(r.score).toBeGreaterThanOrEqual(DUPLICATE_SCORE_THRESHOLD);
    expect(r.reasons).toContain("Name (Geburtsdatum unsicher)");
  });

  it("does not flag a same-name person with a different real DOB", () => {
    const r = scoreDuplicate(
      { vorname: "Peter", nachname: "Fischer", geburtsdatum: "1980-03-03" },
      { ...baseRow, iban1: null, iban1Last4: null, email: null, geburtsdatum: "1992-05-17" },
    );
    expect(r.score).toBeLessThan(DUPLICATE_SCORE_THRESHOLD);
  });

  it("adds weight for matching name and PLZ", () => {
    const r = scoreDuplicate(
      { vorname: "Peter", nachname: "Fischer", geburtsdatum: "1980-03-03", plz: "97469" },
      { ...baseRow, iban1: null, iban1Last4: null, email: null, geburtsdatum: "1992-05-17" },
    );
    expect(r.reasons).toContain("Name und PLZ");
    expect(r.score).toBeGreaterThanOrEqual(DUPLICATE_SCORE_THRESHOLD);
  });

  it("matches on email alone", () => {
    const r = scoreDuplicate(
      { vorname: "Other", nachname: "Name", email: "FischerPeter1992@gmail.com" },
      baseRow,
    );
    expect(r.reasons).toContain("gleiche E-Mail");
    expect(r.score).toBeGreaterThanOrEqual(DUPLICATE_SCORE_THRESHOLD);
  });

  it("returns zero for no signals", () => {
    const r = scoreDuplicate({ vorname: "Nobody", nachname: "Nowhere" }, baseRow);
    expect(r.score).toBe(0);
    expect(r.reasons).toHaveLength(0);
  });
});
