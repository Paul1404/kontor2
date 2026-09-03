import { describe, expect, it } from "vitest";
import {
  brandColorCss,
  contrastForeground,
  contrastRatio,
  darkenForWhiteText,
  normalizeHex,
} from "~/lib/branding-color";

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

describe("darkenForWhiteText", () => {
  it("darkens the SVU crest red until white labels are readable", () => {
    // #f80000 sits at 4.21:1 against white, just under the AA threshold.
    expect(contrastRatio("#f80000", "#ffffff")).toBeLessThan(4.5);
    const button = darkenForWhiteText("#f80000");
    expect(contrastRatio(button, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    // Still recognisably the same red, not a different colour.
    expect(button).toMatch(/^#e[0-9a-f]0000$/);
  });

  it("leaves a colour alone when it already passes", () => {
    expect(darkenForWhiteText("#14223d")).toBe("#14223d");
  });

  it("returns invalid input untouched", () => {
    expect(darkenForWhiteText("nonsense")).toBe("nonsense");
  });

  it("never returns something white text cannot sit on", () => {
    for (const hex of ["#ffff00", "#00ff00", "#ffffff", "#a6864e"]) {
      expect(contrastRatio(darkenForWhiteText(hex), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
  });
});
