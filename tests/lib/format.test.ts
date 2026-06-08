import { describe, expect, it } from "vitest";
import { EMPTY_VALUE, formatPhone, orEmpty, telHref } from "~/lib/format";

describe("orEmpty", () => {
  it("returns the value when present", () => {
    expect(orEmpty("Bamberg")).toBe("Bamberg");
    expect(orEmpty(0)).toBe("0");
    expect(orEmpty(42)).toBe("42");
  });

  it("falls back to the empty glyph for null, undefined and blank", () => {
    expect(orEmpty(null)).toBe(EMPTY_VALUE);
    expect(orEmpty(undefined)).toBe(EMPTY_VALUE);
    expect(orEmpty("")).toBe(EMPTY_VALUE);
    expect(orEmpty("   ")).toBe(EMPTY_VALUE);
  });
});

describe("formatPhone", () => {
  it("collapses whitespace without regrouping digits", () => {
    expect(formatPhone("0123  /  456 789")).toBe("0123 / 456 789");
    expect(formatPhone("  +49 951 12345  ")).toBe("+49 951 12345");
  });

  it("returns null for empty input", () => {
    expect(formatPhone(null)).toBeNull();
    expect(formatPhone("")).toBeNull();
    expect(formatPhone("   ")).toBeNull();
  });
});

describe("telHref", () => {
  it("keeps leading + and digits, drops formatting", () => {
    expect(telHref("+49 (951) 123-45")).toBe("tel:+4995112345");
    expect(telHref("0951 / 12345")).toBe("tel:095112345");
  });

  it("returns null when there are too few digits", () => {
    expect(telHref("12")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});
