import { describe, expect, it } from "vitest";
import { type MandatLite, planMandatNachtrag } from "~/server/domain/mandat-nachtrag";

const eintritt = new Date("2019-04-01");

function mandat(over: Partial<MandatLite>): MandatLite {
  return {
    id: "m1",
    isDeleted: false,
    widerrufenAm: null,
    status: "Aktiv",
    gultigBis: null,
    angelegtAm: new Date("2019-04-09"),
    ...over,
  };
}

describe("planMandatNachtrag", () => {
  it("legt ein Mandat an, wenn gar keins existiert", () => {
    expect(planMandatNachtrag({ eintritt, mandate: [] })).toEqual({ kind: "create" });
  });

  it("legt auch an, wenn nur geloeschte Mandate existieren", () => {
    expect(planMandatNachtrag({ eintritt, mandate: [mandat({ isDeleted: true })] })).toEqual({
      kind: "create",
    });
  });

  it("behandelt ein Mandat mit vergangenem Gültig-bis als nutzbar (kein Ablauf)", () => {
    // A SEPA mandate does not expire on a date: an Aktiv, never-revoked mandate
    // with a long-past gültig-bis is usable, so there is nothing to nachtragen.
    const plan = planMandatNachtrag({
      eintritt,
      mandate: [mandat({ id: "alt", gultigBis: new Date("2010-04-08") })],
    });
    expect(plan).toEqual({ kind: "skip", reason: "Aktives Mandat vorhanden" });
  });

  it("reaktiviert das juengste von mehreren inaktiven Mandaten", () => {
    const plan = planMandatNachtrag({
      eintritt,
      mandate: [
        mandat({ id: "alt", status: "Inaktiv", angelegtAm: new Date("2017-01-01") }),
        mandat({ id: "neu", status: "Inaktiv", angelegtAm: new Date("2021-01-01") }),
      ],
    });
    expect(plan).toEqual({ kind: "reactivate", mandateId: "neu" });
  });

  it("ueberspringt, wenn ein nutzbares Mandat existiert", () => {
    const plan = planMandatNachtrag({ eintritt, mandate: [mandat({})] });
    expect(plan.kind).toBe("skip");
  });

  it("fasst widerrufene Mandate niemals an", () => {
    const plan = planMandatNachtrag({
      eintritt,
      mandate: [
        mandat({ widerrufenAm: new Date("2024-01-01"), gultigBis: new Date("2023-01-01") }),
      ],
    });
    expect(plan.kind).toBe("skip");
    expect((plan as { reason: string }).reason).toContain("widerrufen");
  });

  it("ueberspringt create ohne Eintrittsdatum", () => {
    const plan = planMandatNachtrag({ eintritt: null, mandate: [] });
    expect(plan.kind).toBe("skip");
  });

  it("reaktiviert ein inaktiv gesetztes (nie widerrufenes) Mandat", () => {
    const plan = planMandatNachtrag({
      eintritt,
      mandate: [mandat({ id: "inaktiv", status: "Inaktiv" })],
    });
    expect(plan).toEqual({ kind: "reactivate", mandateId: "inaktiv" });
  });
});
