/**
 * The built-in PDF fonts encode WinAnsi only. Anything outside it is silently
 * mapped by `codepoint & 0xFF`, so "Łukasz Ćwikła" prints as "Aukasz wikBa"
 * with no error, no warning and no replacement glyph. On a Mahnung or a DSGVO
 * response that is a formal document naming the wrong person.
 *
 * Until a Unicode font is embedded, transliterate instead: "Lukasz Cwikla" is
 * not the correct spelling, but it is recognisably the same name, and it is
 * honest about what the document can represent.
 */

/** Characters WinAnsi covers beyond ASCII, so they must pass through unchanged. */
const WIN_ANSI_EXTRA = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹Œ Ž‘’“”•–—˜™š›œ žŸ¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿" +
    "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞß" +
    "àáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ",
);

/** Closest WinAnsi spelling for the letters a German club actually encounters. */
const TRANSLITERATIONS: Record<string, string> = {
  Ł: "L",
  ł: "l",
  Ą: "A",
  ą: "a",
  Ć: "C",
  ć: "c",
  Ę: "E",
  ę: "e",
  Ń: "N",
  ń: "n",
  Ó: "Ó",
  ó: "ó",
  Ś: "S",
  ś: "s",
  Ź: "Z",
  ź: "z",
  Ż: "Z",
  ż: "z",
  Č: "C",
  č: "c",
  Ď: "D",
  ď: "d",
  Ě: "E",
  ě: "e",
  Ň: "N",
  ň: "n",
  Ř: "R",
  ř: "r",
  Š: "Š",
  š: "š",
  Ť: "T",
  ť: "t",
  Ů: "U",
  ů: "u",
  Ž: "Ž",
  ž: "ž",
  Ğ: "G",
  ğ: "g",
  İ: "I",
  ı: "i",
  Ş: "S",
  ş: "s",
  Ā: "A",
  ā: "a",
  Ē: "E",
  ē: "e",
  Ī: "I",
  ī: "i",
  Ū: "U",
  ū: "u",
  Ő: "Ö",
  ő: "ö",
  Ű: "Ü",
  ű: "ü",
  Ạ: "A",
  ạ: "a",
  Đ: "D",
  đ: "d",
  "→": "->",
  "←": "<-",
  "≥": ">=",
  "≤": "<=",
  "✓": "+",
  "•": "·",
  "‑": "-",
  "‒": "-",
  "−": "-",
  " ": " ",
};

/**
 * Make a string safe for the built-in PDF fonts. Unmapped characters are
 * dropped rather than passed through, because passing them through is exactly
 * what produces the wrong glyph.
 */
export function winAnsiSafe(value: string): string {
  let out = "";
  for (const char of value.normalize("NFC")) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80 || WIN_ANSI_EXTRA.has(char)) {
      out += char;
      continue;
    }
    const mapped = TRANSLITERATIONS[char];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    // Strip diacritics before giving up, so "ǎ" still reads as "a".
    const stripped = char.normalize("NFD").replace(/\p{M}+/gu, "");
    out += stripped !== char && stripped.length > 0 ? winAnsiSafe(stripped) : "";
  }
  return out;
}

/** True when the text would lose information in a built-in PDF font. */
export function needsUnicodeFont(value: string): boolean {
  return winAnsiSafe(value) !== value;
}
