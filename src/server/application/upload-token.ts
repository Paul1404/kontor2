import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { DB, DBOrTx } from "~/server/db/client";
import { membershipApplicationTokensTable } from "~/server/db/schema/membership-applications";

const DEFAULT_TTL_DAYS = 30;

function sha256(s: string): string {
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

export function buildUploadUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/antrag/upload/${token}`;
}

export function buildStatusUrl(baseUrl: string, applicationNumber: string, token: string): string {
  const params = new URLSearchParams({ nr: applicationNumber, token });
  return `${baseUrl.replace(/\/+$/, "")}/antrag/status?${params.toString()}`;
}

export async function issueStatusToken(
  db: DBOrTx,
  opts: { applicationId: string; ttlDays?: number },
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = randomToken(32);
  const expiresAt = new Date(Date.now() + (opts.ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000);
  await db.insert(membershipApplicationTokensTable).values({
    applicationId: opts.applicationId,
    tokenHash: sha256(rawToken),
    purpose: "status",
    expiresAt,
  });
  return { rawToken, expiresAt };
}

/**
 * Issue a single-use, hashed token granting the "return the signed paper form"
 * upload for one application. Returns the raw token (never stored) to embed in
 * the link the applicant receives. Mirrors the portal token pattern.
 */
export async function issueUploadToken(
  db: DBOrTx,
  opts: { applicationId: string; ttlDays?: number },
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = randomToken(32);
  const expiresAt = new Date(Date.now() + (opts.ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000);
  await db.insert(membershipApplicationTokensTable).values({
    applicationId: opts.applicationId,
    tokenHash: sha256(rawToken),
    purpose: "upload",
    expiresAt,
  });
  return { rawToken, expiresAt };
}

/**
 * Validate an upload token and, if valid and unconsumed, claim it atomically.
 * Returns the application id it grants the upload for, or null. Single-use:
 * the `consumed_at IS NULL` guard closes the concurrent-claim race.
 */
export async function consumeUploadToken(
  db: DB,
  rawToken: string,
  register?: (tx: DBOrTx, applicationId: string) => Promise<void>,
): Promise<{ applicationId: string } | null> {
  const hash = sha256(rawToken);
  return await db.transaction(async (tx) => {
    const [token] = await tx
      .select()
      .from(membershipApplicationTokensTable)
      .where(
        and(
          eq(membershipApplicationTokensTable.tokenHash, hash),
          eq(membershipApplicationTokensTable.purpose, "upload"),
          gt(membershipApplicationTokensTable.expiresAt, new Date()),
          isNull(membershipApplicationTokensTable.consumedAt),
        ),
      )
      .limit(1);
    if (!token) return null;
    if (!constantEqual(token.tokenHash, hash)) return null;

    const claimed = await tx
      .update(membershipApplicationTokensTable)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(membershipApplicationTokensTable.id, token.id),
          isNull(membershipApplicationTokensTable.consumedAt),
        ),
      )
      .returning({ id: membershipApplicationTokensTable.id });
    if (claimed.length === 0) return null;

    // File-row registration and the workflow status transition must commit with
    // the one-shot claim. If either fails, the token remains reusable.
    await register?.(tx, token.applicationId);

    return { applicationId: token.applicationId };
  });
}

/**
 * Resolve an upload token to its application WITHOUT consuming it -- used to
 * render the upload page before the applicant actually submits a file.
 */
export async function peekUploadToken(
  db: DB,
  rawToken: string,
): Promise<{ applicationId: string } | null> {
  const hash = sha256(rawToken);
  const [token] = await db
    .select({ applicationId: membershipApplicationTokensTable.applicationId })
    .from(membershipApplicationTokensTable)
    .where(
      and(
        eq(membershipApplicationTokensTable.tokenHash, hash),
        eq(membershipApplicationTokensTable.purpose, "upload"),
        gt(membershipApplicationTokensTable.expiresAt, new Date()),
        isNull(membershipApplicationTokensTable.consumedAt),
      ),
    )
    .limit(1);
  return token ?? null;
}

/** Resolve a reusable bearer token for the public application-status page. */
export async function peekStatusToken(
  db: DBOrTx,
  rawToken: string,
): Promise<{ applicationId: string } | null> {
  const hash = sha256(rawToken);
  const [token] = await db
    .select({ applicationId: membershipApplicationTokensTable.applicationId })
    .from(membershipApplicationTokensTable)
    .where(
      and(
        eq(membershipApplicationTokensTable.tokenHash, hash),
        eq(membershipApplicationTokensTable.purpose, "status"),
        gt(membershipApplicationTokensTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return token ?? null;
}
