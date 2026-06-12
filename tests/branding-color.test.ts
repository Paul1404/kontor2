import { describe, expect, it } from "vitest";
import { brandColorCss, contrastForeground, normalizeHex } from "~/lib/branding-color";

describe("normalizeHex", () => {
  it("normalisiert auf #rrggbb klein", () => {
    expect(normalizeHex("#1D4ED8")).toBe("#1d4ed8");
    expect(normalizeHex("1d4ed8")).toBe("#1d4ed8");
    expect(normalizeHex("  #ABCDEF ")).toBe("#abcdef");
  });
  it("verwirft Ungültiges", () => {
    expect(normalizeHex("rot")).toBeNull();
    expect(normalizeHex("#12")).toBeNull();
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe("contrastForeground", () => {
  it("weiß auf dunkler Marke, fast-schwarz auf heller", () => {
    expect(contrastForeground("#1d4ed8")).toBe("#ffffff"); // dunkles Blau
    expect(contrastForeground("#dc2626")).toBe("#ffffff"); // Rot
    expect(contrastForeground("#fde047")).toBe("#0a0a0a"); // helles Gelb
  });
});

describe("brandColorCss", () => {
  it("baut :root- und .dark-Overrides für eine gültige Farbe", () => {
    const css = brandColorCss("#1d4ed8");
    expect(css).toContain("--color-primary:#1d4ed8");
    expect(css).toContain("--color-brand:#1d4ed8");
    expect(css).toContain("--color-ring:#1d4ed8");
    expect(css).toContain("--color-primary-foreground:#ffffff");
    expect(css.startsWith(":root{")).toBe(true);
    expect(css).toContain(".dark{");
  });
  it("leerer String ohne gültige Farbe (kein Override)", () => {
    expect(brandColorCss(null)).toBe("");
    expect(brandColorCss("kaputt")).toBe("");
  });
});
