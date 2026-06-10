/**
 * Derived lifecycle state of an admin invite. An invite is `accepted` once the
 * recipient has set their password, `revoked` if an admin pulled it back,
 * `expired` once it ages past its window, and otherwise still `pending` (the
 * only state in which it can be revoked or accepted). Accepted/revoked win over
 * expiry so the UI shows what actually happened, not just that time passed.
 */
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export function invitationStatus(
  inv: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date,
): InvitationStatus {
  if (inv.acceptedAt) return "accepted";
  if (inv.revokedAt) return "revoked";
  if (inv.expiresAt.getTime() < now.getTime()) return "expired";
  return "pending";
}
