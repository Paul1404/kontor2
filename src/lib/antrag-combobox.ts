/**
 * Pure helpers for the address combobox on the public Beitritts-Antrag.
 * Kept free of React so keyboard navigation and match highlighting can be
 * unit-tested without a browser.
 */

/** Keys the combobox reacts to for moving the active option. */
export type ComboboxNavKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function isComboboxNavKey(key: string): key is ComboboxNavKey {
  return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End";
}

/**
 * Next active option index for a navigation key. `null` means no option is
 * highlighted yet; ArrowDown then starts at the top and ArrowUp at the bottom.
 * Movement wraps around so the list never feels like a dead end.
 */
export function moveActiveOption(
  current: number | null,
  count: number,
  key: ComboboxNavKey,
): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return last;
    case "ArrowDown":
      return current === null || current >= last ? 0 : current + 1;
    case "ArrowUp":
      return current === null || current <= 0 ? last : current - 1;
  }
}

export type MatchSegment = { text: string; hit: boolean };

/** Lower-case, diacritics folded, so "Strasse" highlights inside "Straße". */
function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Split a suggestion into plain and highlighted segments for the typed query.
 * Matching is case- and diacritics-insensitive; only the first occurrence is
 * highlighted. Folding "ß" to "ss" can change string length, so the split is
 * computed character by character on the original text.
 */
export function splitMatch(text: string, query: string): MatchSegment[] {
  const q = fold(query.trim());
  if (!q || !text) return [{ text, hit: false }];
  // Map each folded position back to the original character index.
  const originIndex: number[] = [];
  let folded = "";
  for (let i = 0; i < text.length; i++) {
    const piece = fold(text[i] ?? "");
    for (let j = 0; j < piece.length; j++) originIndex.push(i);
    folded += piece;
  }
  const start = folded.indexOf(q);
  if (start < 0) return [{ text, hit: false }];
  const from = originIndex[start] ?? 0;
  const to = (originIndex[start + q.length - 1] ?? text.length - 1) + 1;
  const segments: MatchSegment[] = [];
  if (from > 0) segments.push({ text: text.slice(0, from), hit: false });
  segments.push({ text: text.slice(from, to), hit: true });
  if (to < text.length) segments.push({ text: text.slice(to), hit: false });
  return segments;
}

/** A house number should carry at least one digit ("12", "12a", "3-5"). */
export function looksLikeHausnummer(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && v.length <= 10 && /\d/.test(v);
}
