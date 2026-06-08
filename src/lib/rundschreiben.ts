/**
 * Merge-field rendering for Rundschreiben, shared by the server (the mail that
 * goes out) and the client (the live preview) so the two never drift. No server
 * imports -- safe in the browser.
 */

export type MergeVars = {
  anrede: string;
  vorname: string;
  nachname: string;
  name: string;
  mitgliedsnummer: string;
};

/** The fields a Rundschreiben body may reference, with a German label. */
export const MERGE_FIELDS = [
  { token: "{{anrede}}", label: "Anrede" },
  { token: "{{vorname}}", label: "Vorname" },
  { token: "{{nachname}}", label: "Nachname" },
  { token: "{{name}}", label: "Voller Name" },
  { token: "{{mitgliedsnummer}}", label: "Mitgliedsnummer" },
] as const;

const TOKEN = /\{\{\s*(anrede|vorname|nachname|name|mitgliedsnummer)\s*\}\}/g;

/** Replace known {{tokens}} with the member's values; unknown ones stay as-is. */
export function renderTemplate(template: string, vars: MergeVars): string {
  return template.replace(TOKEN, (_m, key: keyof MergeVars) => vars[key] ?? "");
}

/** A representative recipient for the preview and the test mail. */
export const SAMPLE_VARS: MergeVars = {
  anrede: "Frau",
  vorname: "Erika",
  nachname: "Mustermann",
  name: "Erika Mustermann",
  mitgliedsnummer: "M-000123",
};
