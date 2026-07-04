/**
 * Manueller Status-Override für eine Sollstellung.
 *
 * Der Beitragslauf und die SEPA-/Mahn-Flüsse setzen den Status automatisch
 * (`eingezogen` beim Lauf, `returned` beim Rückläufer, `paid` bei erfasster
 * Zahlung). Manchmal muss der Vorstand einen Posten aber von Hand korrigieren,
 * etwa einen falsch als „bezahlt" gebuchten wieder auf „eingezogen" oder
 * „offen" zurücksetzen. Diese Funktion kapselt, welche Beträge zu welchem
 * Zielstatus gehören, damit `paidAmount`/`openAmount`/`mahnstufe` immer
 * konsistent bleiben.
 *
 * `returned` ist bewusst KEIN Ziel: dieser Status trägt die Rücklastschrift-Spur
 * (Gebühr, Grund-Code) und wird nur über `record_sepa_return` gesetzt, nie
 * manuell nachgestellt.
 */

/** Zielstatus, die manuell gesetzt werden dürfen. */
export const OVERRIDABLE_STATUSES = ["open", "eingezogen", "paid", "cancelled"] as const;
export type OverridableStatus = (typeof OVERRIDABLE_STATUSES)[number];

export function isOverridableStatus(value: string): value is OverridableStatus {
  return (OVERRIDABLE_STATUSES as readonly string[]).includes(value);
}

export type StatusOverridePlan = {
  status: OverridableStatus;
  paidAmount: string;
  openAmount: string;
  mahnstufe: number;
};

/**
 * Beträge und Mahnstufe für den Zielstatus. `amount` ist der Sollbetrag des
 * Postens (bleibt unangetastet).
 *
 * - `open`: offen, nichts bezahlt, voll mahnbar, Mahnstufe zurück auf 0.
 * - `eingezogen`: per Lastschrift eingezogen, offener Betrag 0, nicht mahnbar.
 * - `paid`: bezahlt, offener Betrag 0.
 * - `cancelled`: storniert, weder offen noch bezahlt.
 */
export function planSollstellungStatus(
  row: { amount: string },
  target: OverridableStatus,
): StatusOverridePlan {
  switch (target) {
    case "open":
      return { status: "open", paidAmount: "0", openAmount: row.amount, mahnstufe: 0 };
    case "eingezogen":
      return { status: "eingezogen", paidAmount: row.amount, openAmount: "0", mahnstufe: 0 };
    case "paid":
      return { status: "paid", paidAmount: row.amount, openAmount: "0", mahnstufe: 0 };
    case "cancelled":
      return { status: "cancelled", paidAmount: "0", openAmount: "0", mahnstufe: 0 };
  }
}
