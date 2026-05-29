import { count, eq } from "drizzle-orm";
import { auth } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";

/**
 * Setup-mode check. The instance is "in setup mode" while the users table is
 * empty: the /setup route is accessible without auth, and a single
 * `completeSetup` call creates the first admin. Once any user exists this
 * always returns `false` — no further setup is possible without an admin.
 *
 * Counterpart to the env-driven `ensureBootstrapAdmin`: when an operator
 * forgets to set SVUWV_BOOTSTRAP_ADMIN_* before first deploy, this is the
 * recovery path that avoids the catch-22 of "first user must be an admin,
 * but you need an admin to create users."
 */
export async function isInSetupMode(): Promise<boolean> {
  const [row] = await db().select({ c: count() }).from(users);
  return (row?.c ?? 0) === 0;
}

export type SetupResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "already_initialized" | "create_failed"; message?: string };

export async function completeSetup(input: {
  email: string;
  password: string;
  name: string;
}): Promise<SetupResult> {
  // Re-check inside the same transaction so two parallel POSTs can't both
  // win the race and create two "first" admins.
  return await db().transaction(async (tx) => {
    const [row] = await tx.select({ c: count() }).from(users);
    if ((row?.c ?? 0) > 0) {
      return { ok: false, reason: "already_initialized" } as const;
    }
    try {
      // createUser bypasses `disableSignUp: true`. Called without headers
      // so it skips the admin-session check (same trick as bootstrap).
      const created = await auth().api.createUser({
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
      console.log(`[setup] created first admin ${input.email} via /setup`);
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
