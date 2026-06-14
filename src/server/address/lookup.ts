/**
 * Address lookup for the public Beitritts-Antrag.
 *
 * Primary source is the OpenPLZ directory (openplzapi.org), the free, official
 * German postal/street directory (Destatis-based). It covers small Orte and
 * Gemeindeteile -- e.g. "Schweinfurter Weg, 97508 Grettstadt" -- that
 * OpenStreetMap/Nominatim does not reliably return for partial, as-you-type
 * queries. Nominatim stays as a fallback when OpenPLZ returns nothing or is
 * unavailable.
 *
 * Results are cached in Redis (PLZ codes effectively never change; street
 * lists rarely do). Both sources degrade to an empty result so the form stays
 * usable without autocomplete. Outbound calls only happen from the server.
 */
import { nominatimPlz, nominatimStreets, type StreetHit } from "~/server/address/nominatim";
import { logger } from "~/server/lib/logger";
import { redis } from "~/server/redis/client";

export type { StreetHit };

const OPENPLZ_URL = "https://openplzapi.org/de";
const USER_AGENT = "kontor2/1.0 (Vereinsverwaltung; +https://github.com/Paul1404/kontor2)";

// Versioned key prefix so the cutover to OpenPLZ does not serve stale
// Nominatim-only results cached under the previous scheme.
const PLZ_CACHE_TTL = 60 * 60 * 24 * 30; // 30 days
const STREET_CACHE_TTL = 60 * 60 * 24; // 1 day

type OpenPlzStreet = { name?: string; postalCode?: string; locality?: string };
type OpenPlzLocality = { name?: string; postalCode?: string };

async function openPlz<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const url = new URL(`${OPENPLZ_URL}/${path}`);
  url.search = new URLSearchParams(params).toString();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      logger.warn("address.openplz.non_ok", { status: res.status, path });
      return [];
    }
    const json = await res.json();
    return Array.isArray(json) ? (json as T[]) : [];
  } catch (err) {
    logger.warn("address.openplz.failed", {
      error: err instanceof Error ? err.message : String(err),
      path,
    });
    return [];
  }
}

/** Map OpenPLZ street rows to StreetHit, deduplicated and capped at 8. Pure. */
export function mapOpenPlzStreets(rows: OpenPlzStreet[]): StreetHit[] {
  const seen = new Set<string>();
  const hits: StreetHit[] = [];
  for (const r of rows) {
    if (!r.name) continue;
    const hit: StreetHit = { strasse: r.name, plz: r.postalCode ?? "", ort: r.locality ?? "" };
    const key = `${hit.strasse}|${hit.plz}|${hit.ort}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(hit);
    if (hits.length >= 8) break;
  }
  return hits;
}

/** Deduplicated Orte for a PLZ from the OpenPLZ directory. Pure. */
export function mapOpenPlzLocalities(rows: OpenPlzLocality[]): string[] {
  const orte = new Set<string>();
  for (const r of rows) if (r.name) orte.add(r.name);
  return [...orte].sort((a, b) => a.localeCompare(b, "de"));
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

/** Resolve a 5-digit PLZ to the list of matching Orte. OpenPLZ, then Nominatim. */
export async function lookupPlz(plzRaw: string): Promise<string[]> {
  const plz = plzRaw.trim();
  if (!/^\d{5}$/.test(plz)) return [];
  return cached(`addr:v2:plz:${plz}`, PLZ_CACHE_TTL, async () => {
    const rows = await openPlz<OpenPlzLocality>("Localities", { postalCode: plz });
    const orte = mapOpenPlzLocalities(rows);
    if (orte.length > 0) return orte;
    return nominatimPlz(plz);
  });
}

/** Street autocomplete, optionally scoped to a PLZ. OpenPLZ, then Nominatim. */
export async function searchStreets(queryRaw: string, plzRaw?: string): Promise<StreetHit[]> {
  const query = queryRaw.trim();
  const plz = (plzRaw ?? "").trim();
  if (query.length < 3) return [];
  const scopedPlz = /^\d{5}$/.test(plz) ? plz : undefined;
  const key = `addr:v2:street:${scopedPlz ?? "_"}:${query.toLowerCase()}`;
  return cached(key, STREET_CACHE_TTL, async () => {
    const params: Record<string, string> = { name: query };
    if (scopedPlz) params.postalCode = scopedPlz;
    const rows = await openPlz<OpenPlzStreet>("Streets", params);
    const hits = mapOpenPlzStreets(rows);
    if (hits.length > 0) return hits;
    return nominatimStreets(query, scopedPlz);
  });
}
