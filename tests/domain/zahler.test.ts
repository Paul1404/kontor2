import { describe, expect, it } from "vitest";
import { resolveZahler } from "~/server/domain/zahler";

describe("resolveZahler", () => {
  it("Familien-Zahler gewinnt fuer aktive Kinder", () => {
    expect(
      resolveZahler({
        memberId: "kind",
        familieZahlerId: "papa",
        vertreterId: "oma",
        minderjaehrig: true,
      }),
    ).toEqual({ zahlerId: "papa", quelle: "familie" });
  });

  it("Vertreter zahlt fuer Minderjaehrige ohne Familie", () => {
    expect(
      resolveZahler({
        memberId: "kind",
        familieZahlerId: null,
        vertreterId: "mama",
        minderjaehrig: true,
      }),
    ).toEqual({ zahlerId: "mama", quelle: "vertreter" });
  });

  it("Vertreter zaehlt NICHT fuer Erwachsene (keine automatische Umleitung)", () => {
    expect(
      resolveZahler({
        memberId: "erwachsen",
        familieZahlerId: null,
        vertreterId: "betreuer",
        minderjaehrig: false,
      }),
    ).toEqual({ zahlerId: "erwachsen", quelle: "selbst" });
  });

  it("faellt auf Selbstzahler zurueck", () => {
    expect(
      resolveZahler({
        memberId: "m",
        familieZahlerId: null,
        vertreterId: null,
        minderjaehrig: true,
      }),
    ).toEqual({ zahlerId: "m", quelle: "selbst" });
  });

  it("ignoriert Selbstreferenzen (Zahler = Mitglied)", () => {
    expect(
      resolveZahler({
        memberId: "m",
        familieZahlerId: "m",
        vertreterId: "m",
        minderjaehrig: true,
      }),
    ).toEqual({ zahlerId: "m", quelle: "selbst" });
  });
});
