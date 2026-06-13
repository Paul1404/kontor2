import { and, count, eq, ne } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";

/**
 * Refuses any operation that would leave zero non-banned admins. Guards
 * against the better-auth admin plugin's REST endpoints (set-user-banned,
 * remove-user, set-role) silently locking everyone out — the plugin itself
 * has no concept of "the last admin".
 *
 * The custom `setRole` procedure has its own check; this is the request-
 * level catch-all for the plugin's own endpoints.
 */
export type LastAdminAction = "ban" | "demote" | "delete";

export async function wouldRemoveLastAdmin(
  db: DB,
  targetUserId: string,
  action: LastAdminAction,
): Promise<boolean> {
  const [target] = await db
    .select({ role: users.role, banned: users.banned })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target) return false;
  if (target.role !== "admin") return false;
  if (action !== "delete" && target.banned === true) return false;

  const [row] = await db
    .select({ c: count() })
    .from(users)
    .where(
      and(
        eq(users.role, "admin"),
        ne(users.id, targetUserId),
        // an already-banned admin doesn't count toward "active admins"
        eq(users.banned, false),
      ),
    );
  return (row?.c ?? 0) === 0;
}

const ADMIN_PLUGIN_ROUTES = [
  { suffix: "/admin/set-user-banned", action: "ban" as const, userIdField: "userId" },
  { suffix: "/admin/remove-user", action: "delete" as const, userIdField: "userId" },
  { suffix: "/admin/set-role", action: "demote" as const, userIdField: "userId" },
] as const;

type RouteMatch = (typeof ADMIN_PLUGIN_ROUTES)[number];

function matchAdminRoute(url: URL): RouteMatch | null {
  for (const r of ADMIN_PLUGIN_ROUTES) {
    if (url.pathname.endsWith(r.suffix)) return r;
  }
  return null;
}

/**
 * Inspects an inbound POST to the better-auth admin plugin and, if it targets
 * the last active admin, returns an error response without forwarding to the
 * handler. Returns `null` when the request should be forwarded as-is.
 */
export async function guardAdminPluginRequest(db: DB, request: Request): Promise<Response | null> {
  if (request.method !== "POST") return null;
  const url = new URL(request.url);
  const match = matchAdminRoute(url);
  if (!match) return null;

  // Body is small JSON; clone so the downstream handler still sees it.
  const cloned = request.clone();
  let body: Record<string, unknown> = {};
  try {
    body = (await cloned.json()) as Record<string, unknown>;
  } catch {
    // Malformed body — let the better-auth handler return its own error.
    return null;
  }
  const targetUserId = body[match.userIdField];
  if (typeof targetUserId !== "string") return null;

  // set-role specifically: only flag when the *new* role is not admin.
  // better-auth accepts `role` as a string or string[], so normalize both.
  if (match.action === "demote") {
    const roles = Array.isArray(body.role) ? body.role : [body.role];
    if (roles.includes("admin")) return null;
  }
  // set-user-banned: only flag when the request actually bans (banned=true).
  if (match.action === "ban") {
    if (body.banned !== true) return null;
  }

  const wouldLock = await wouldRemoveLastAdmin(db, targetUserId, match.action);
  if (!wouldLock) return null;

  return new Response(
    JSON.stringify({
      error: "LAST_ADMIN",
      message:
        `Refused: ${match.action} would leave zero active admins. ` +
        `Promote another user to admin first.`,
    }),
    { status: 409, headers: { "content-type": "application/json" } },
  );
}
