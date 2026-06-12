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
    expect(
      planMandatNachtrag({ eintritt, mandate: [mandat({ isDeleted: true })] }),
    ).toEqual({ kind: "create" });
  });

  it("reaktiviert ein nur abgelaufenes Mandat statt ein zweites anzulegen", () => {
    const plan = planMandatNachtrag({
      eintritt,
      mandate: [mandat({ id: "alt", gultigBis: new Date("2023-04-08") })],
    });
    expect(plan).toEqual({ kind: "reactivate", mandateId: "alt" });
  });

  it("reaktiviert das juengste von mehreren abgelaufenen", () => {
    const plan = planMandatNachtrag({
      eintritt,
      mandate: [
        mandat({ id: "alt", gultigBis: new Date("2020-01-01"), angelegtAm: new Date("2017-01-01") }),
        mandat({ id: "neu", gultigBis: new Date("2023-01-01"), angelegtAm: new Date("2021-01-01") }),
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
      mandate: [mandat({ widerrufenAm: new Date("2024-01-01"), gultigBis: new Date("2023-01-01") })],
    });
    expect(plan.kind).toBe("skip");
    expect((plan as { reason: string }).reason).toContain("widerrufen");
  });

  it("ueberspringt create ohne Eintrittsdatum", () => {
    const plan = planMandatNachtrag({ eintritt: null, mandate: [] });
    expect(plan.kind).toBe("skip");
  });

  it("behandelt Status Inaktiv wie abgelaufen (reaktivieren)", () => {
    const plan = planMandatNachtrag({
      eintritt,
      mandate: [mandat({ id: "inaktiv", status: "Inaktiv" })],
    });
    expect(plan).toEqual({ kind: "reactivate", mandateId: "inaktiv" });
  });
});
