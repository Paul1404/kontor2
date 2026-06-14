import { eq } from "drizzle-orm";
import { auth, type Session } from "~/server/auth/auth";
import { users } from "~/server/db/schema";
import type { Role } from "~/server/db/schema/auth";
import type { AppContext } from "~/server/orpc/context";

const ROLE_RANK: Record<Role, number> = { readonly: 1, vorstand: 2, admin: 3 };

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** The lower-privilege of two roles (the cap). Unknown grant = no cap. */
export function lowerRole(granted: Role | undefined, live: Role): Role {
  if (!granted || !(granted in ROLE_RANK)) return live;
  return ROLE_RANK[granted] <= ROLE_RANK[live] ? granted : live;
}

/** Role frozen on the key at issuance (issue #191), if present. */
export function grantedRoleOf(metadata: unknown): Role | undefined {
  const raw = typeof metadata === "string" ? safeParse(metadata) : metadata;
  const role = (raw as { grantedRole?: unknown } | null)?.grantedRole;
  return typeof role === "string" && role in ROLE_RANK ? (role as Role) : undefined;
}

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

  // Cap the key's effective role at min(role granted at issuance, owner's
  // current role). This stops a later promotion of the owner from silently
  // widening an already-issued key beyond what an admin confirmed (#191).
  // Keys issued before grantedRole existed have no cap (fall back to live role).
  const liveRole = (user.role as Role | undefined) ?? "readonly";
  const effectiveRole = lowerRole(grantedRoleOf(result.key.metadata), liveRole);
  const cappedUser = { ...user, role: effectiveRole };

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
    user: cappedUser,
  } as unknown as Session;

  return { ...base, session };
}
