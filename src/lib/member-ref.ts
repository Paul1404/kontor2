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
