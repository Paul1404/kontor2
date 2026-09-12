import { describe, expect, it } from "vitest";
import { formatAuditValue } from "~/lib/audit-labels";
import {
  EMPTY_VALUE,
  formatDateInput,
  formatDecimalInput,
  formatPhone,
  orEmpty,
  parseDateInput,
  telHref,
} from "~/lib/format";

describe("formatDecimalInput", () => {
  it("removes only insignificant fixed-scale zero padding", () => {
    expect(formatDecimalInput("96.00000000")).toBe("96");
    expect(formatDecimalInput("54.50000000")).toBe("54.5");
    expect(formatDecimalInput("0.00010000")).toBe("0.0001");
    expect(formatDecimalInput("12,3400")).toBe("12,34");
  });

  it("keeps blank and non-decimal input safe", () => {
    expect(formatDecimalInput(null)).toBe("");
    expect(formatDecimalInput(" ")).toBe("");
    expect(formatDecimalInput("variabel")).toBe("variabel");
    expect(formatDecimalInput("-0.00000000")).toBe("0");
  });
});

describe("decimal presentation", () => {
  it("formats monetary audit values as currency and other decimals without padding", () => {
    expect(formatAuditValue("betrag", "96.00000000")).toContain("96,00");
    expect(formatAuditValue("betrag", "96.00000000")).not.toContain(".000000");
    expect(formatAuditValue("eProz", "12.50000000")).toBe("12.5");
  });
});

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

describe("formatDateInput", () => {
  it("turns an ISO date into German DD.MM.YYYY", () => {
    expect(formatDateInput("2020-01-15")).toBe("15.01.2020");
    expect(formatDateInput("1999-12-31")).toBe("31.12.1999");
  });

  it("returns blank for empty or malformed input", () => {
    expect(formatDateInput("")).toBe("");
    expect(formatDateInput(null)).toBe("");
    expect(formatDateInput(undefined)).toBe("");
    expect(formatDateInput("nonsense")).toBe("");
  });
});

describe("parseDateInput", () => {
  it("parses German dates to ISO", () => {
    expect(parseDateInput("15.01.2020")).toBe("2020-01-15");
    expect(parseDateInput("1.2.2020")).toBe("2020-02-01");
    expect(parseDateInput("31.12.1999")).toBe("1999-12-31");
  });

  it("accepts ISO and slash or dash separators", () => {
    expect(parseDateInput("2020-01-15")).toBe("2020-01-15");
    expect(parseDateInput("15/01/2020")).toBe("2020-01-15");
    expect(parseDateInput("15-01-2020")).toBe("2020-01-15");
  });

  it("pivots two-digit years on the current year", () => {
    // Today (per the test environment) is well past 2000, so a low two-digit
    // year reads as 20xx and a high one as 19xx.
    expect(parseDateInput("15.01.05")).toBe("2005-01-15");
    expect(parseDateInput("15.01.85")).toBe("1985-01-15");
  });

  it("trims surrounding whitespace", () => {
    expect(parseDateInput("  15.01.2020  ")).toBe("2020-01-15");
  });

  it("returns blank for empty input", () => {
    expect(parseDateInput("")).toBe("");
    expect(parseDateInput("   ")).toBe("");
    expect(parseDateInput(null)).toBe("");
    expect(parseDateInput(undefined)).toBe("");
  });

  it("returns null for impossible or unparseable dates", () => {
    expect(parseDateInput("31.02.2020")).toBeNull();
    expect(parseDateInput("32.01.2020")).toBeNull();
    expect(parseDateInput("15.13.2020")).toBeNull();
    expect(parseDateInput("hello")).toBeNull();
    expect(parseDateInput("15.01")).toBeNull();
  });
});
