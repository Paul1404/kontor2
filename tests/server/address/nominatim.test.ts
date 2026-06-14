import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The Nominatim client is now the fallback behind OpenPLZ. It maps raw
// Nominatim responses; PLZ-format and min-length guards live in the
// orchestrator (~/server/address/lookup), not here.
import { nominatimPlz, nominatimStreets } from "~/server/address/nominatim";

function stubFetch(items: unknown) {
  const fn = vi.fn(async () => ({
    ok: true,
    json: async () => items,
  })) as unknown as typeof fetch;
  globalThis.fetch = fn;
  return fn;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("nominatimPlz", () => {
  it("returns deduplicated Orte matching the postcode echo, sorted", async () => {
    stubFetch([
      { address: { postcode: "97508", city: "Grettstadt" } },
      { address: { postcode: "97508", village: "Grettstadt" } },
      { address: { postcode: "97508", town: "Abtswind" } },
      { address: { postcode: "99999", city: "Woanders" } },
    ]);
    expect(await nominatimPlz("97508")).toEqual(["Abtswind", "Grettstadt"]);
  });

  it("falls back to any Ort when no postcode echoes back", async () => {
    stubFetch([{ address: { municipality: "Schweinfurt" } }]);
    expect(await nominatimPlz("97421")).toEqual(["Schweinfurt"]);
  });
});

describe("nominatimStreets", () => {
  it("maps and deduplicates street hits", async () => {
    stubFetch([
      { address: { road: "Triebweg", postcode: "97508", city: "Grettstadt" } },
      { address: { road: "Triebweg", postcode: "97508", city: "Grettstadt" } },
      { address: { road: "Hauptstraße", postcode: "97508", village: "Grettstadt" } },
      { address: { postcode: "97508", city: "Grettstadt" } },
    ]);
    expect(await nominatimStreets("Tri", "97508")).toEqual([
      { strasse: "Triebweg", plz: "97508", ort: "Grettstadt" },
      { strasse: "Hauptstraße", plz: "97508", ort: "Grettstadt" },
    ]);
  });
});
