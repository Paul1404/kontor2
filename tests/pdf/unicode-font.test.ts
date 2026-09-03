import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { ensurePdfFont } from "~/server/pdf/fonts";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { MitteilungDocument } from "~/server/pdf/templates/mitteilung";

/**
 * Without an embedded font the built-in PDF encoding maps anything outside
 * WinAnsi by `codepoint & 0xFF`, silently: "Łukasz Ćwikła" came out as
 * "Aukasz wikBa" on formal documents. This renders a real letter and reads the
 * characters back out of the PDF, because a test that only checks the input
 * would not have noticed any of that.
 */
function embeddedCharacters(base64: string): Set<string> {
  const raw = Buffer.from(base64, "base64").toString("latin1");
  let text = "";
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try {
      text += zlib.inflateSync(Buffer.from(match[1] ?? "", "latin1")).toString("latin1");
    } catch {
      // Not every stream is deflate-compressed; skip what will not inflate.
    }
  }
  return new Set(
    [...text.matchAll(/beginbfchar[\s\S]*?endbfchar/g)]
      .flatMap((block) => [...block[0].matchAll(/<[0-9A-Fa-f]{4}>\s*<([0-9A-Fa-f]{4,})>/g)])
      .map((pair) => String.fromCharCode(Number.parseInt((pair[1] ?? "").slice(0, 4), 16))),
  );
}

async function renderSample(text: string): Promise<Set<string>> {
  const { base64 } = await renderPdfBase64(
    MitteilungDocument({
      club: { vereinsname: "SV Beispiel", senderLine: "SV · Straße 1 · 97440", logoDataUri: null },
      docRef: "MT-2026-TEST",
      model: {
        recipientLines: ["Frau", text, "Vereinsstraße 1", "97440 Beispielstadt"],
        reference: "M-TEST",
        referenceLabel: "Mitgliedsnummer",
        datum: "03.09.2026",
        subject: text,
        greeting: `Sehr geehrte ${text},`,
        blocks: [{ kind: "paragraph", text }],
        closing: "Freundliche Grüße",
      },
    }),
  );
  return embeddedCharacters(base64);
}

describe("PDF mit eingebetteter Unicode-Schrift", () => {
  it("hat die Schriftdateien zur Hand", () => {
    expect(ensurePdfFont()).toBe(true);
  });

  it("bettet polnische, tschechische und türkische Zeichen korrekt ein", async () => {
    const chars = await renderSample("Łukasz Ćwikła Šimon Dvořák Gülşen Çağrı");
    for (const char of ["Ł", "ł", "Ć", "Š", "ř", "á", "ü", "ş", "ğ", "ı", "Ç"]) {
      expect(chars, `Zeichen ${char} fehlt im PDF`).toContain(char);
    }
  });

  it("verliert die vertrauten Zeichen nicht", async () => {
    const chars = await renderSample("Grüße 84,00 € – „Zitat“ · Straße");
    for (const char of ["ü", "ß", "€", "–", "„", "“", "·"]) {
      expect(chars, `Zeichen ${char} fehlt im PDF`).toContain(char);
    }
  });
});
