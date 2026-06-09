import { afterEach, describe, expect, it, vi } from "vitest";

// No Redis in the unit env: make redis() throw so the cache helper falls
// straight through to a live lookup (which we stub via fetch).
vi.mock("~/server/redis/client", () => ({
  redis: () => {
    throw new Error("no redis in test");
  },
}));
vi.mock("~/server/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { lookupPlz, searchStreets } from "~/server/address/nominatim";

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

describe("lookupPlz", () => {
  it("rejects a non-5-digit PLZ without calling the network", async () => {
    const fn = stubFetch([]);
    expect(await lookupPlz("123")).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns deduplicated Orte matching the postcode echo, sorted", async () => {
    stubFetch([
      { address: { postcode: "97508", city: "Grettstadt" } },
      { address: { postcode: "97508", village: "Grettstadt" } },
      { address: { postcode: "97508", town: "Abtswind" } },
      { address: { postcode: "99999", city: "Woanders" } },
    ]);
    expect(await lookupPlz("97508")).toEqual(["Abtswind", "Grettstadt"]);
  });

  it("falls back to any Ort when no postcode echoes back", async () => {
    stubFetch([{ address: { municipality: "Schweinfurt" } }]);
    expect(await lookupPlz("97421")).toEqual(["Schweinfurt"]);
  });
});

describe("searchStreets", () => {
  it("ignores short queries", async () => {
    const fn = stubFetch([]);
    expect(await searchStreets("ab")).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("maps and deduplicates street hits", async () => {
    stubFetch([
      { address: { road: "Triebweg", postcode: "97508", city: "Grettstadt" } },
      { address: { road: "Triebweg", postcode: "97508", city: "Grettstadt" } },
      { address: { road: "Hauptstraße", postcode: "97508", village: "Grettstadt" } },
      { address: { postcode: "97508", city: "Grettstadt" } },
    ]);
    expect(await searchStreets("Tri", "97508")).toEqual([
      { strasse: "Triebweg", plz: "97508", ort: "Grettstadt" },
      { strasse: "Hauptstraße", plz: "97508", ort: "Grettstadt" },
    ]);
  });
});
