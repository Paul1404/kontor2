/**
 * German address lookup via OpenStreetMap Nominatim. This is the FALLBACK
 * source behind the OpenPLZ directory (see ./lookup.ts): Nominatim's structured
 * street search is geocoding-oriented and misses partial, as-you-type queries
 * in small Orte and Gemeindeteile, and its usage policy caps us near 1 req/s.
 * It still backs up OpenPLZ for anything the directory does not return.
 *
 * Any network or parsing failure returns an empty result so the form stays
 * usable without autocomplete. Outbound calls only happen from the server.
 * Caching lives in the orchestrator (./lookup.ts), not here.
 */
import { logger } from "~/server/lib/logger";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "kontor2/1.0 (Vereinsverwaltung; +https://github.com/Paul1404/kontor2)";

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

/** Resolve a 5-digit PLZ to the list of matching Orte (deduplicated). */
export async function nominatimPlz(plz: string): Promise<string[]> {
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
}

/** Street autocomplete, optionally scoped to a PLZ. Returns up to 8 hits. */
export async function nominatimStreets(query: string, plz?: string): Promise<StreetHit[]> {
  const params: Record<string, string> = { street: query, limit: "8" };
  if (plz && /^\d{5}$/.test(plz)) params.postalcode = plz;
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
}
