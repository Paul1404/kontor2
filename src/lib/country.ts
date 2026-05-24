/**
 * Linear Webverein stores `land` as a short numeric code in the `adresse`
 * table. The mapping is implicit in the source data; values observed so far:
 *   1 = Deutschland   2 = Österreich   3 = Schweiz   etc.
 *
 * Anything that already looks like a country name (the imported data also
 * contains free-text values like "Deutschland") passes through unchanged.
 */
const LAND_CODE_TO_NAME: Record<string, string> = {
  "1": "Deutschland",
  "2": "Österreich",
  "3": "Schweiz",
  "4": "Frankreich",
  "5": "Italien",
  "6": "Niederlande",
  "7": "Belgien",
  "8": "Luxemburg",
  "9": "Dänemark",
  "10": "Polen",
};

export function formatLand(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  const mapped = LAND_CODE_TO_NAME[trimmed];
  if (mapped) return mapped;
  return trimmed;
}

export const LAND_OPTIONS: { value: string; label: string }[] = Object.entries(
  LAND_CODE_TO_NAME,
).map(([value, label]) => ({ value, label }));
