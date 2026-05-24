/**
 * Linear Webverein stores Abteilung as a single varchar(80) string. We split
 * it into multiple Abteilungs-Mitgliedschaften so the schema can support
 * many-to-many membership with per-Abteilung Eintritts/Austrittsdaten.
 *
 * Separator: comma, slash, semicolon, or pipe. Whitespace around tokens is
 * trimmed; duplicates (case-insensitive) are deduplicated.
 */
const SEP = /[,/;|]+/;

export function splitAbteilung(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(SEP)) {
    const t = part.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
