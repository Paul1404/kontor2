/**
 * Regenerate src/server/lib/data/blz-de.json from the Bundesbank's public
 * BLZ XML file. Run roughly quarterly (the file is updated every ~3 months).
 *
 * Usage:  bun scripts/generate-blz.ts
 */
import fs from "node:fs";
import path from "node:path";

const URL =
  "https://www.bundesbank.de/resource/blob/602630/c7d70cf2da18f1a04bf18ca7e0bbe554/mL/blz-aktuell-txt-data.txt";
const OUT = path.join(import.meta.dir, "..", "src/server/lib/data/blz-de.json");

const xml = await (await fetch(URL)).text();

const entries: Record<string, { name: string; bic: string }> = {};
const regex =
  /<BLZ>(\d+)<\/BLZ><Merkmal>(\d+)<\/Merkmal><Bezeichnung>([^<]+)<\/Bezeichnung>[^<]*(?:<[^B][^>]*>[^<]*<\/[^>]+>[^<]*)*?<BIC>([A-Z0-9]+)<\/BIC>/g;
let total = 0;
for (;;) {
  const m = regex.exec(xml);
  if (!m) break;
  total++;
  const [, blz, merkmal, name, bic] = m;
  // Merkmal "1" = Hauptbankleitzahl (primary). Skip secondaries.
  if (merkmal !== "1") continue;
  entries[blz] = { name: name.trim(), bic };
}

fs.writeFileSync(OUT, JSON.stringify(entries));
console.log(
  `Parsed ${total} entries, wrote ${Object.keys(entries).length} primaries to ${OUT} (${fs.statSync(OUT).size} bytes)`,
);
