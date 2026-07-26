import { createHash } from "node:crypto";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { auth } from "~/server/auth/auth";
import { dbForTenant, db as primaryDb } from "~/server/db/client";
import { setupBootstrapTokens, users } from "~/server/db/schema/auth";
import { logger } from "~/server/lib/logger";
import type { Tenant } from "~/server/tenants/registry";
import { primaryTenant } from "~/server/tenants/resolve";

/** The Verein's database: the primary uses the process DATABASE_URL pool;
 * other Vereine use their own. */
function tenantDb(tenant: Tenant) {
  return tenant.key === primaryTenant().key ? primaryDb() : dbForTenant(tenant.databaseUrl);
}

/**
 * Setup-mode check for a Verein. The Verein is "in setup mode" while its users
 * table is empty: the /setup route is accessible without auth, and a single
 * `completeSetup` call creates the first admin. Once any user exists this
 * always returns `false` — no further setup is possible without an admin.
 *
 * This is the sole path to the first admin. It avoids the catch-22 of "the
 * first user must be an admin, but you need an admin to create users": on a
 * fresh Verein you visit /setup once and create it in the browser with the
 * one-time capability issued during provisioning. Operates on the Verein's own
 * database.
 */
export async function isInSetupMode(tenant: Tenant): Promise<boolean> {
  const [row] = await tenantDb(tenant).select({ c: count() }).from(users);
  return (row?.c ?? 0) === 0;
}

export type SetupResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      reason: "already_initialized" | "invalid_bootstrap_token" | "create_failed";
      message?: string;
    };

export async function completeSetup(
  tenant: Tenant,
  input: {
    email: string;
    password: string;
    name: string;
    bootstrapToken?: string;
  },
): Promise<SetupResult> {
  const db = tenantDb(tenant);
  const tokenHash = input.bootstrapToken
    ? createHash("sha256").update(input.bootstrapToken).digest("hex")
    : null;
  return await db.transaction(async (tx) => {
    // The better-auth call below writes through its own connection. Serialize
    // before checking users so two public setup requests cannot both see an
    // empty table and create separate admins.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kontor2:first-admin-setup'))`);
    const [row] = await tx.select({ c: count() }).from(users);
    if ((row?.c ?? 0) > 0) {
      return { ok: false, reason: "already_initialized" } as const;
    }
    if (process.env.NODE_ENV === "production") {
      // The primary tenant may receive its initial capability via deployment
      // secret. Only the digest is persisted. Provisioned tenants already have
      // a generated digest in this table.
      const envToken = process.env.SETUP_BOOTSTRAP_TOKEN;
      if (envToken) {
        const [existing] = await tx
          .select({ id: setupBootstrapTokens.id })
          .from(setupBootstrapTokens);
        if (!existing) {
          await tx.insert(setupBootstrapTokens).values({
            id: 1,
            tokenHash: createHash("sha256").update(envToken).digest("hex"),
          });
        }
      }
      if (!tokenHash) return { ok: false, reason: "invalid_bootstrap_token" } as const;
      const [claimed] = await tx
        .update(setupBootstrapTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(setupBootstrapTokens.id, 1),
            eq(setupBootstrapTokens.tokenHash, tokenHash),
            isNull(setupBootstrapTokens.consumedAt),
          ),
        )
        .returning({ id: setupBootstrapTokens.id });
      if (!claimed) return { ok: false, reason: "invalid_bootstrap_token" } as const;
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
