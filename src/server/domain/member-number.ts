/**
 * App-owned member and contact numbers.
 *
 * The app used to reuse Linear's `MITGLNR` / `AdrNr` verbatim. These are the
 * replacement: short, opaque, prefixed codes the app mints itself.
 *
 * Format: `<prefix>-<6 symbols>` where the prefix is `M` for members and `K`
 * for non-member contacts (Kontakte). Symbols come from a Crockford base32
 * alphabet with the ambiguous letters I, L, O and U removed, so a code is
 * unambiguous when read aloud or printed on a Mahnung.
 *
 * 32^6 ≈ 1.07 billion codes per namespace. For a club of a few thousand rows
 * the per-insert collision probability is on the order of 1e-5, so the unique
 * index plus `withUniqueRetry` (which regenerates on a 23505) more than covers
 * it. The code carries no order or count information, by design.
 *
 * Pure module: it does not touch the database. Uniqueness is enforced by the
 * partial unique indexes on `members.member_no` / `members.kontakt_no`; callers
 * insert and retry on collision.
 */

/** Crockford base32 minus I, L, O, U. Exactly 32 symbols. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 6;

export type NumberKind = "member" | "kontakt";

const PREFIX: Record<NumberKind, string> = {
  member: "M",
  kontakt: "K",
};

/** `M-XXXXXX` for members, `K-XXXXXX` for contacts. */
export const MEMBER_NUMBER_RE = /^[MK]-[0-9A-HJKMNP-TV-Z]{6}$/;

/**
 * Generate a random app-owned number for the given namespace. The body is six
 * symbols drawn uniformly from the 32-symbol alphabet. 32 divides 256 evenly,
 * so masking a random byte with 0x1f is already unbiased -- no rejection
 * sampling needed.
 */
export function generateMemberNumber(kind: NumberKind): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let body = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    body += ALPHABET.charAt((bytes[i] ?? 0) & 0x1f);
  }
  return `${PREFIX[kind]}-${body}`;
}

/** True for a well-formed `M-`/`K-` number. */
export function isValidMemberNumber(value: string): boolean {
  return MEMBER_NUMBER_RE.test(value);
}

/** Throw on a malformed number; use at trust boundaries before persisting. */
export function assertValidMemberNumber(value: string): void {
  if (!isValidMemberNumber(value)) {
    throw new Error(`Ungültige Nummer: ${value}`);
  }
}
