import { describe, expect, it } from "vitest";
import { type MergeVars, renderTemplate } from "~/lib/rundschreiben";

const vars: MergeVars = {
  anrede: "Herr",
  vorname: "Max",
  nachname: "Mustermann",
  name: "Max Mustermann",
  mitgliedsnummer: "M-000042",
};

describe("renderTemplate", () => {
  it("replaces all known merge fields", () => {
    const out = renderTemplate(
      "Hallo {{vorname}} {{nachname}} ({{mitgliedsnummer}}), Anrede {{anrede}}, Name {{name}}.",
      vars,
    );
    expect(out).toBe("Hallo Max Mustermann (M-000042), Anrede Herr, Name Max Mustermann.");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("Hi {{ vorname }}!", vars)).toBe("Hi Max!");
  });

  it("leaves unknown tokens untouched", () => {
    expect(renderTemplate("{{vorname}} {{unbekannt}}", vars)).toBe("Max {{unbekannt}}");
  });

  it("replaces every occurrence of a repeated field", () => {
    expect(renderTemplate("{{vorname}}-{{vorname}}", vars)).toBe("Max-Max");
  });

  it("renders an empty string for a field with no value", () => {
    expect(renderTemplate("[{{vorname}}]", { ...vars, vorname: "" })).toBe("[]");
  });
});
