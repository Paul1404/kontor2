import { describe, expect, it } from "vitest";
import { parsePayerName } from "~/server/orpc/procedures/sepa";

/**
 * Der Kontoinhaber-String hat im Altbestand keine feste Reihenfolge
 * ("Vorname Nachname" wie "Nachname Vorname"). Anker ist der Nachname des
 * Kindes: er steht immer im String, also wird er zum Nachname und der Rest zum
 * Vorname -- unabhängig von der Reihenfolge.
 */
describe("parsePayerName", () => {
  it("Vorname zuerst: 'Tanja Nürnberger'", () => {
    expect(parsePayerName("Tanja Nürnberger", "Nürnberger")).toEqual({
      vorname: "Tanja",
      nachname: "Nürnberger",
    });
  });

  it("Nachname zuerst: 'Reinhart Jessica'", () => {
    expect(parsePayerName("Reinhart Jessica", "Reinhart")).toEqual({
      vorname: "Jessica",
      nachname: "Reinhart",
    });
  });

  it("Doppelter Vorname/Name um den Kind-Nachnamen herum", () => {
    expect(parsePayerName("Bettina Kell Andrade", "Kell")).toEqual({
      vorname: "Bettina Andrade",
      nachname: "Kell",
    });
  });

  it("entfernt führende Anrede", () => {
    expect(parsePayerName("Frau Theresia Dorsch", "Dorsch")).toEqual({
      vorname: "Theresia",
      nachname: "Dorsch",
    });
  });

  it("kollabiert doppelte Leerzeichen", () => {
    expect(parsePayerName("Theresia  Dorsch", "Dorsch")).toEqual({
      vorname: "Theresia",
      nachname: "Dorsch",
    });
  });

  it("fällt ohne Kind-Nachname auf letztes Token zurück", () => {
    expect(parsePayerName("Corinna Pfrang", null)).toEqual({
      vorname: "Corinna",
      nachname: "Pfrang",
    });
  });
});
