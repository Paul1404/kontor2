import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Font } from "@react-pdf/renderer";

/**
 * The built-in PDF fonts encode WinAnsi only, and anything outside it is mapped
 * by `codepoint & 0xFF` with no error at all: "Łukasz Ćwikła" printed as
 * "Aukasz wikBa" on Mahnungen, Austrittsbestätigungen and DSGVO responses.
 * Embedding a Unicode font is the only way to spell those names correctly.
 *
 * IBM Plex Sans, OFL-1.1, the same family the interface already uses. The files
 * live in `public/` because the Dockerfile copies that directory into the
 * runtime image, the same route `clubLogoDataUri` takes.
 */

export const PDF_FONT_FAMILY = "IBMPlexSans";
const FALLBACK_FAMILY = "Helvetica";
const FALLBACK_BOLD = "Helvetica-Bold";

const FILES = [
  { rel: "public/fonts/IBMPlexSans-Regular.ttf", weight: 400 as const },
  { rel: "public/fonts/IBMPlexSans-SemiBold.ttf", weight: 600 as const },
];

let registered: boolean | undefined;

/**
 * Register the embedded font once per process. Returns false when the files are
 * missing, so rendering still produces a document rather than throwing; callers
 * then fall back to transliteration, which loses accents but never prints a
 * different letter.
 */
export function ensurePdfFont(): boolean {
  if (registered !== undefined) return registered;
  try {
    // A Buffer is rejected at runtime ("dataUrl.substring is not a function"),
    // so the absolute path is what the renderer needs.
    const sources = FILES.map((file) => {
      const path = resolve(process.cwd(), file.rel);
      if (!existsSync(path)) throw new Error(`missing ${file.rel}`);
      return { src: path, fontWeight: file.weight };
    });
    Font.register({ family: PDF_FONT_FAMILY, fonts: sources });
    registered = true;
  } catch {
    registered = false;
  }
  return registered;
}

/** Font family for body text, falling back to a built-in font. */
export function pdfFamily(): string {
  return ensurePdfFont() ? PDF_FONT_FAMILY : FALLBACK_FAMILY;
}

/**
 * Bold face. The embedded family carries its own weights; the built-in
 * fallback needs the separate bold font name instead.
 */
export function pdfBoldFamily(): string {
  return ensurePdfFont() ? PDF_FONT_FAMILY : FALLBACK_BOLD;
}

/** Weight to pair with `pdfBoldFamily()`; ignored by the built-in fallback. */
export function pdfBoldWeight(): 600 | undefined {
  return ensurePdfFont() ? 600 : undefined;
}
