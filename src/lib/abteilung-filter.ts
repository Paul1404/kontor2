/**
 * Sentinel value for the member-list `abteilungId` filter that means
 * "members without an active department membership". Shared by the member-list
 * UI and the `members.list` procedure so both agree on the magic value.
 */
export const ABTEILUNG_NONE_FILTER = "__none__";

/**
 * Canonical name for the real "Keine Abteilung" department. Linear stored a
 * "Keine-Abteilung" sentinel that the importer used to drop; it now maps to
 * this department so those members are visible and manageable.
 */
export const KEINE_ABTEILUNG_NAME = "Keine Abteilung";

/** True for any Linear spelling of the "no department" sentinel. */
export function isKeineAbteilung(name: string): boolean {
  return /keine[-\s]?abteilung/i.test(name);
}
