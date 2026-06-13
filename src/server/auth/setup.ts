import { count, eq } from "drizzle-orm";
import { auth } from "~/server/auth/auth";
import { dbForTenant } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { logger } from "~/server/lib/logger";
import type { Tenant } from "~/server/tenants/registry";

/**
 * Setup-mode check for a Verein. The Verein is "in setup mode" while its users
 * table is empty: the /setup route is accessible without auth, and a single
 * `completeSetup` call creates the first admin. Once any user exists this
 * always returns `false` — no further setup is possible without an admin.
 *
 * This is the sole path to the first admin. It avoids the catch-22 of "the
 * first user must be an admin, but you need an admin to create users": on a
 * fresh Verein you visit /setup once and create it in the browser. No secret in
 * the environment. Operates on the Verein's own database.
 */
export async function isInSetupMode(tenant: Tenant): Promise<boolean> {
  const [row] = await dbForTenant(tenant.databaseUrl).select({ c: count() }).from(users);
  return (row?.c ?? 0) === 0;
}

export type SetupResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "already_initialized" | "create_failed"; message?: string };

export async function completeSetup(
  tenant: Tenant,
  input: {
    email: string;
    password: string;
    name: string;
  },
): Promise<SetupResult> {
  const db = dbForTenant(tenant.databaseUrl);
  // Re-check inside the same transaction so two parallel POSTs can't both
  // win the race and create two "first" admins.
  return await db.transaction(async (tx) => {
    const [row] = await tx.select({ c: count() }).from(users);
    if ((row?.c ?? 0) > 0) {
      return { ok: false, reason: "already_initialized" } as const;
    }
    try {
      // createUser bypasses `disableSignUp: true`. Called without headers so it
      // skips the admin-session check. Uses this Verein's auth instance, so the
      // admin lands in this Verein's database.
      const created = await auth(tenant).api.createUser({
        body: {
          email: input.email,
          password: input.password,
          name: input.name,
          role: "admin",
        },
      });
      if (!created?.user?.id) {
        return { ok: false, reason: "create_failed" } as const;
      }
      await tx.update(users).set({ emailVerified: true }).where(eq(users.id, created.user.id));
      logger.info("first admin created via /setup", { email: input.email, tenant: tenant.key });
      return { ok: true, userId: created.user.id } as const;
    } catch (err) {
      return {
        ok: false,
        reason: "create_failed",
        message: (err as Error).message,
      } as const;
    }
  });
}
