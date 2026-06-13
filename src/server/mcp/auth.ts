import { eq } from "drizzle-orm";
import { auth, type Session } from "~/server/auth/auth";
import { users } from "~/server/db/schema";
import type { AppContext } from "~/server/orpc/context";

/**
 * Turn a raw `x-api-key` value into a full AppContext for the MCP endpoint.
 *
 * The better-auth api-key plugin verifies the key (hash lookup, enabled flag,
 * expiry, per-key rate limit) and tells us which user owns it. We then
 * synthesize a Session around that user's real row, so everything downstream
 * (oRPC `requireAuth` role gating, `appendAudit` actorEmail, observability
 * logs) behaves exactly as if the key owner had called the procedure with a
 * browser session. Keys are deliberately NOT honored anywhere else in the app
 * (`enableSessionForAPIKeys` is off); this resolver is the only entry point.
 *
 * Returns null for any invalid, disabled, expired, rate-limited or orphaned
 * key. The route maps null to a 401.
 */
export async function resolveApiKeyContext(
  base: AppContext,
  rawKey: string,
): Promise<AppContext | null> {
  const result = await auth(base.tenant).api.verifyApiKey({ body: { key: rawKey } });
  if (!result.valid || !result.key) return null;

  const [user] = await base.db
    .select()
    .from(users)
    .where(eq(users.id, result.key.referenceId))
    .limit(1);
  if (!user || user.banned) return null;

  const now = new Date();
  // Narrow cast: Session is inferred from better-auth's getSession return.
  // The shape below mirrors it (admin-plugin fields included); the key id in
  // `session.id` makes MCP activity attributable in logs.
  const session = {
    session: {
      id: `apikey:${result.key.id}`,
      token: "",
      userId: user.id,
      expiresAt: result.key.expiresAt ?? new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: result.key.createdAt,
      updatedAt: result.key.updatedAt,
      ipAddress: null,
      userAgent: "mcp-api-key",
      impersonatedBy: null,
    },
    user,
  } as unknown as Session;

  return { ...base, session };
}
