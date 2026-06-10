import { describe, expect, it } from "vitest";
import { invitationStatus } from "~/server/auth/invitation-status";

const now = new Date("2026-06-10T12:00:00Z");
const future = new Date("2026-06-17T12:00:00Z");
const past = new Date("2026-06-03T12:00:00Z");

describe("invitationStatus", () => {
  it("is pending while unaccepted, unrevoked and not yet expired", () => {
    expect(invitationStatus({ acceptedAt: null, revokedAt: null, expiresAt: future }, now)).toBe(
      "pending",
    );
  });

  it("is expired once past the window", () => {
    expect(invitationStatus({ acceptedAt: null, revokedAt: null, expiresAt: past }, now)).toBe(
      "expired",
    );
  });

  it("is revoked when revokedAt is set, even before expiry", () => {
    expect(invitationStatus({ acceptedAt: null, revokedAt: now, expiresAt: future }, now)).toBe(
      "revoked",
    );
  });

  it("is accepted when acceptedAt is set, regardless of expiry or revocation", () => {
    expect(invitationStatus({ acceptedAt: now, revokedAt: null, expiresAt: past }, now)).toBe(
      "accepted",
    );
    expect(invitationStatus({ acceptedAt: now, revokedAt: now, expiresAt: future }, now)).toBe(
      "accepted",
    );
  });
});
