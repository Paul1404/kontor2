import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import { membersTable } from "~/server/db/schema/members";
import { portalSessionsTable, portalTokensTable } from "~/server/db/schema/portal";

const PORTAL_COOKIE = "svuwv_portal";
const SESSION_TTL_DAYS = 30;
const DEFAULT_TOKEN_TTL_DAYS = 14;

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function constantEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function buildPortalUrl(baseUrl: string, token: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/portal/zugang/${token}`;
}

/**
 * Create a fresh single-use portal token for a member. Returns the raw token
 * (NOT stored anywhere — must be embedded in the URL the member receives).
 */
export async function issuePortalToken(
  db: DB,
  opts: {
    memberId: string;
    sentToEmail: string | null;
    ttlDays?: number;
    createdBy: string;
  },
): Promise<{ tokenId: string; rawToken: string; expiresAt: Date }> {
  const rawToken = randomToken(32);
  const expiresAt = new Date(
    Date.now() + (opts.ttlDays ?? DEFAULT_TOKEN_TTL_DAYS) * 24 * 60 * 60 * 1000,
  );
  const [row] = await db
    .insert(portalTokensTable)
    .values({
      memberId: opts.memberId,
      tokenHash: sha256(rawToken),
      sentToEmail: opts.sentToEmail,
      expiresAt,
      createdBy: opts.createdBy,
    })
    .returning({ id: portalTokensTable.id });
  if (!row) throw new Error("portal_tokens insert returned no row");
  return { tokenId: row.id, rawToken, expiresAt };
}

/**
 * Validate an inbound token (from URL) and, if valid, spawn a session.
 * Returns the cookie value the client must persist + the member it grants
 * access to. Constant-time comparison guards against timing attacks.
 */
export async function consumePortalToken(
  db: DB,
  rawToken: string,
  meta: { ipAddress: string | null; userAgent: string | null },
): Promise<{
  cookieValue: string;
  cookieMaxAgeSeconds: number;
  memberId: string;
} | null> {
  const hash = sha256(rawToken);
  return await db.transaction(async (tx) => {
    const [token] = await tx
      .select()
      .from(portalTokensTable)
      .where(
        and(
          eq(portalTokensTable.tokenHash, hash),
          gt(portalTokensTable.expiresAt, new Date()),
          isNull(portalTokensTable.revokedAt),
          // Single-use: a token that already minted a session can't mint
          // another. Without this a leaked/forwarded magic link kept
          // granting fresh 30-day sessions until natural expiry.
          isNull(portalTokensTable.consumedAt),
        ),
      )
      .limit(1);
    if (!token) return null;
    if (!constantEqual(token.tokenHash, hash)) return null;

    // Claim the token atomically before creating the session. The
    // conditional `consumed_at IS NULL` closes the race where two requests
    // present the same token concurrently — only one claim succeeds.
    const claimed = await tx
      .update(portalTokensTable)
      .set({ consumedAt: new Date() })
      .where(and(eq(portalTokensTable.id, token.id), isNull(portalTokensTable.consumedAt)))
      .returning({ id: portalTokensTable.id });
    if (claimed.length === 0) return null;

    const sessionSecret = randomToken(48);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const [session] = await tx
      .insert(portalSessionsTable)
      .values({
        memberId: token.memberId,
        secretHash: sha256(sessionSecret),
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        createdFromTokenId: token.id,
      })
      .returning({ id: portalSessionsTable.id });
    if (!session) throw new Error("portal_sessions insert returned no row");

    const cookieValue = `${session.id}.${sessionSecret}`;
    return {
      cookieValue,
      cookieMaxAgeSeconds: SESSION_TTL_DAYS * 24 * 60 * 60,
      memberId: token.memberId,
    };
  });
}

/**
 * Look up the member behind a portal cookie. Returns null if the cookie is
 * malformed, expired, revoked, or the secret does not match.
 */
export async function resolvePortalSession(
  db: DB,
  cookieValue: string | null | undefined,
): Promise<{ sessionId: string; memberId: string } | null> {
  if (!cookieValue) return null;
  const idx = cookieValue.indexOf(".");
  if (idx <= 0 || idx === cookieValue.length - 1) return null;
  const sessionId = cookieValue.slice(0, idx);
  const secret = cookieValue.slice(idx + 1);
  if (!sessionId || !secret) return null;

  const [session] = await db
    .select()
    .from(portalSessionsTable)
    .where(
      and(
        eq(portalSessionsTable.id, sessionId),
        gt(portalSessionsTable.expiresAt, new Date()),
        isNull(portalSessionsTable.revokedAt),
      ),
    )
    .limit(1);
  if (!session) return null;
  if (!constantEqual(session.secretHash, sha256(secret))) return null;

  // Refresh lastSeen — best-effort, ignore failures.
  await db
    .update(portalSessionsTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(portalSessionsTable.id, sessionId))
    .catch(() => undefined);

  return { sessionId: session.id, memberId: session.memberId };
}

export async function loadPortalMember(db: DB, memberId: string) {
  const [m] = await db
    .select({
      id: membersTable.id,
      mitgliedsnummer: membersTable.mitgliedsnummer,
      adrNr: membersTable.adrNr,
      anrede: membersTable.anrede,
      vorname: membersTable.vorname,
      nachname: membersTable.nachname,
      geburtsdatum: membersTable.geburtsdatum,
      strasse: membersTable.strasse,
      hausnummer: membersTable.hausnummer,
      plz: membersTable.plz,
      ort: membersTable.ort,
      land: membersTable.land,
      telefon1: membersTable.telefon1,
      telefon2: membersTable.telefon2,
      email: membersTable.email,
      eintritt: membersTable.eintritt,
      austritt: membersTable.austritt,
    })
    .from(membersTable)
    .where(eq(membersTable.id, memberId))
    .limit(1);
  return m ?? null;
}

export function portalCookieName(): string {
  return PORTAL_COOKIE;
}

export function buildPortalCookie(value: string, maxAgeSeconds: number, isSecure: boolean): string {
  const parts = [
    `${PORTAL_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}

export function clearPortalCookieHeader(isSecure: boolean): string {
  const parts = [`${PORTAL_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}

export function getPortalCookieFromHeaders(headers: Headers): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${PORTAL_COOKIE}=([^;]+)`));
  return m ? m[1]! : null;
}
