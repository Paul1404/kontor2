import { describe, expect, it } from "vitest";
import { mapOpenPlzLocalities, mapOpenPlzStreets } from "~/server/address/lookup";

describe("mapOpenPlzStreets", () => {
  it("maps name/postalCode/locality to StreetHit and the real-world case resolves", () => {
    const hits = mapOpenPlzStreets([
      { name: "Schweinfurter Weg", postalCode: "97508", locality: "Grettstadt" },
    ]);
    expect(hits).toEqual([{ strasse: "Schweinfurter Weg", plz: "97508", ort: "Grettstadt" }]);
  });

  it("drops rows without a name, dedupes, and caps at 8", () => {
    const rows = [
      { name: "", postalCode: "97508", locality: "Grettstadt" },
      { name: "A-Weg", postalCode: "97508", locality: "Grettstadt" },
      { name: "A-Weg", postalCode: "97508", locality: "Grettstadt" },
      ...Array.from({ length: 10 }, (_, i) => ({
        name: `Strasse ${i}`,
        postalCode: "97508",
        locality: "Grettstadt",
      })),
    ];
    const hits = mapOpenPlzStreets(rows);
    expect(hits.length).toBe(8);
    expect(hits.filter((h) => h.strasse === "A-Weg").length).toBe(1);
    expect(hits.every((h) => h.strasse !== "")).toBe(true);
  });

  it("tolerates missing postalCode/locality", () => {
    expect(mapOpenPlzStreets([{ name: "Nur Strasse" }])).toEqual([
      { strasse: "Nur Strasse", plz: "", ort: "" },
    ]);
  });
});

describe("mapOpenPlzLocalities", () => {
  it("dedupes and sorts the Orte", () => {
    expect(
      mapOpenPlzLocalities([
        { name: "Grettstadt", postalCode: "97508" },
        { name: "Grettstadt", postalCode: "97508" },
      ]),
    ).toEqual(["Grettstadt"]);
    expect(
      mapOpenPlzLocalities([
        { name: "Zell", postalCode: "1" },
        { name: "Aach", postalCode: "1" },
      ]),
    ).toEqual(["Aach", "Zell"]);
  });

  it("ignores rows without a name", () => {
    expect(mapOpenPlzLocalities([{ postalCode: "97508" }, { name: "Grettstadt" }])).toEqual([
      "Grettstadt",
    ]);
  });
});
