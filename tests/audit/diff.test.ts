import { describe, expect, it } from "vitest";
import { diff } from "~/server/audit/log";

describe("diff", () => {
  it("emits only changed fields", () => {
    const d = diff(
      { vorname: "Anna", nachname: "Beispiel", plz: "97520" },
      { vorname: "Anna", nachname: "Müller", plz: "97520" },
    );
    expect(Object.keys(d)).toEqual(["nachname"]);
    expect(d.nachname).toEqual({ before: "Beispiel", after: "Müller" });
  });

  it("masks IBAN columns to last4", () => {
    const d = diff({ iban1: "DE00 0000 0000 0000 1234" }, { iban1: "DE00 0000 0000 0000 5678" });
    expect(d.iban1).toEqual({ before: "1234", after: "5678" });
  });

  it("treats null and undefined as equal", () => {
    const d = diff({ x: null }, { x: undefined });
    expect(d).toEqual({});
  });

  it("compares Date by time value", () => {
    const a = new Date("2024-01-01T00:00:00Z");
    const b = new Date("2024-01-01T00:00:00Z");
    expect(diff({ eintritt: a }, { eintritt: b })).toEqual({});
  });

  it("creates create-diff from null before", () => {
    const d = diff(null, { vorname: "Anna" });
    expect(d.vorname).toEqual({ before: null, after: "Anna" });
  });
});
