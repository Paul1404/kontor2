/**
 * German address lookup via OpenStreetMap Nominatim, used by the public
 * Beitritts-Antrag for PLZ -> Ort resolution and street autocomplete. This is
 * the same data source the standalone svums app used.
 *
 * Nominatim's usage policy asks for an identifying User-Agent and at most ~1
 * request per second. We keep volume low with aggressive Redis caching (PLZ
 * codes effectively never change) and degrade gracefully: any network or
 * parsing failure returns an empty result so the form stays usable without
 * autocomplete. Outbound calls only happen from the server, never the client.
 */
import { logger } from "~/server/lib/logger";
import { redis } from "~/server/redis/client";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  "kontor2/1.0 (Vereinsverwaltung SV Untereuerheim; +https://github.com/Paul1404/kontor2)";

const PLZ_CACHE_TTL = 60 * 60 * 24 * 30; // 30 days
const STREET_CACHE_TTL = 60 * 60 * 24; // 1 day

export type StreetHit = { strasse: string; plz: string; ort: string };

type NominatimAddress = {
  road?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  suburb?: string;
};

type NominatimItem = { address?: NominatimAddress };

function ortOf(a: NominatimAddress | undefined): string {
  return a?.city ?? a?.town ?? a?.village ?? a?.municipality ?? "";
}

async function nominatim(params: Record<string, string>): Promise<NominatimItem[]> {
  const url = new URL(NOMINATIM_URL);
  url.search = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "de",
    "accept-language": "de",
    ...params,
  }).toString();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      logger.warn("address.nominatim.non_ok", { status: res.status });
      return [];
    }
    const json = (await res.json()) as NominatimItem[];
    return Array.isArray(json) ? json : [];
  } catch (err) {
    logger.warn("address.nominatim.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

async function cached<T>(key: string, ttl: number, miss: () => Promise<T>): Promise<T> {
  let client: ReturnType<typeof redis> | null = null;
  try {
    client = redis();
    const hit = await client.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    // Redis unavailable: fall through to a live lookup.
  }
  const value = await miss();
  try {
    await client?.set(key, JSON.stringify(value), "EX", ttl);
  } catch {
    // Caching is best-effort.
  }
  return value;
}

/** Resolve a 5-digit PLZ to the list of matching Orte (deduplicated). */
export async function lookupPlz(plzRaw: string): Promise<string[]> {
  const plz = plzRaw.trim();
  if (!/^\d{5}$/.test(plz)) return [];
  return cached(`addr:plz:${plz}`, PLZ_CACHE_TTL, async () => {
    const items = await nominatim({ postalcode: plz, limit: "30" });
    const orte = new Set<string>();
    for (const item of items) {
      const ort = ortOf(item.address);
      if (ort && item.address?.postcode === plz) orte.add(ort);
    }
    // Fall back to any Ort if none matched the exact postcode echo.
    if (orte.size === 0) {
      for (const item of items) {
        const ort = ortOf(item.address);
        if (ort) orte.add(ort);
      }
    }
    return [...orte].sort((a, b) => a.localeCompare(b, "de"));
  });
}

/** Street autocomplete, optionally scoped to a PLZ. Returns up to 8 hits. */
export async function searchStreets(queryRaw: string, plzRaw?: string): Promise<StreetHit[]> {
  const query = queryRaw.trim();
  const plz = (plzRaw ?? "").trim();
  if (query.length < 3) return [];
  const key = `addr:street:${plz || "_"}:${query.toLowerCase()}`;
  return cached(key, STREET_CACHE_TTL, async () => {
    const params: Record<string, string> = { street: query, limit: "8" };
    if (/^\d{5}$/.test(plz)) params.postalcode = plz;
    const items = await nominatim(params);
    const seen = new Set<string>();
    const hits: StreetHit[] = [];
    for (const item of items) {
      const strasse = item.address?.road ?? "";
      if (!strasse) continue;
      const ort = ortOf(item.address);
      const postcode = item.address?.postcode ?? "";
      const dedupe = `${strasse}|${postcode}|${ort}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      hits.push({ strasse, plz: postcode, ort });
    }
    return hits;
  });
}
