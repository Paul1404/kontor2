/**
 * Canonical, human-facing reference and route key for a member/contact row.
 * Client-safe (no server imports) so routes and components can build links and
 * labels without crossing the server boundary. The server domain module
 * (`~/server/domain/member`) re-exports this so both sides agree.
 *
 * Preference order: the app-owned numbers first (`memberNo` for members,
 * `kontaktNo` for contacts), then the preserved legacy Linear number, and only
 * as a last resort the internal `adrNr`. The chain is backward-tolerant, so a
 * caller that has not yet projected the app numbers still produces a value the
 * `members.get` resolver can open.
 */
export type MemberRefParts = {
  memberNo?: string | null;
  kontaktNo?: string | null;
  mitgliedsnummer?: string | null;
  adrNr?: number | null;
};

export function memberRef(parts: MemberRefParts): string {
  return (
    parts.memberNo ??
    parts.kontaktNo ??
    (parts.mitgliedsnummer?.trim() || null) ??
    (parts.adrNr != null ? `A${parts.adrNr}` : "")
  );
}

/**
 * The legacy Linear Mitgliedsnummer to print as its own "Mitgliedsnummer (alt)"
 * line on documents, or null when there is none. During the transition the
 * app-owned number is the headline, but members still recognize their old
 * Linear number, so letters carry both. Suppressed when the legacy number is
 * already what `shownRef` displays (a member without an app number, where
 * `memberRef` falls back to the legacy value), so the page never shows the same
 * number twice. Pass an empty `shownRef` when no primary reference is printed.
 */
export function altMitgliedsnummer(
  mitgliedsnummer: string | null | undefined,
  shownRef: string,
): string | null {
  const value = mitgliedsnummer?.trim();
  if (!value) return null;
  return value === shownRef.trim() ? null : value;
}
