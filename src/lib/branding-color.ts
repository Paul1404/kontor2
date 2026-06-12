/**
 * Markenfarben-Helfer fürs White-Label. Rein und getestet: nimmt die
 * konfigurierte Hex-Farbe und baut daraus die CSS-Variablen-Overrides für die
 * Tailwind-Tokens (--color-primary / --color-brand / --color-ring), inklusive
 * einer kontrastsicheren Vordergrundfarbe.
 */

const HEX = /^#?([0-9a-fA-F]{6})$/;

/** Normalisiert auf "#rrggbb" Kleinbuchstaben; null bei ungültiger Eingabe. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = HEX.exec(input.trim());
  return m ? `#${m[1]!.toLowerCase()}` : null;
}

/** Relative Luminanz (0..1) nach sRGB, für die Kontrastwahl. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** Lesbarer Vordergrund auf der Markenfarbe: nahezu weiß oder fast schwarz. */
export function contrastForeground(hex: string): string {
  return luminance(hex) > 0.5 ? "#0a0a0a" : "#ffffff";
}

/**
 * CSS, das die Marken-Tokens auf die konfigurierte Farbe setzt. Wird im
 * Dokumentkopf nach dem Stylesheet eingehängt, damit es die @theme-Defaults
 * überschreibt (gleiche :root-Spezifität, spätere Regel gewinnt). Light- und
 * Dark-Mode bekommen dieselbe Farbe; das genügt fürs erste White-Label.
 * Leerer String, wenn keine gültige Farbe gesetzt ist (dann bleibt das Default).
 */
export function brandColorCss(input: string | null | undefined): string {
  const hex = normalizeHex(input);
  if (!hex) return "";
  const fg = contrastForeground(hex);
  const vars =
    `--color-primary:${hex};--color-primary-foreground:${fg};` +
    `--color-brand:${hex};--color-brand-foreground:${fg};--color-ring:${hex};`;
  return `:root{${vars}}.dark{${vars}}`;
}
