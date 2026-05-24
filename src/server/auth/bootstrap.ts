import { count, eq } from "drizzle-orm";
import { auth } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { env } from "~/server/env";

let attempted = false;

/**
 * Creates a first admin user from `SVUWV_BOOTSTRAP_ADMIN_EMAIL` and
 * `SVUWV_BOOTSTRAP_ADMIN_PASSWORD` if the users table is empty. Runs at most
 * once per process. Safe to call on every request; subsequent calls are a
 * cheap COUNT query.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  if (attempted) return;
  attempted = true;
  const e = env();
  if (!e.SVUWV_BOOTSTRAP_ADMIN_EMAIL || !e.SVUWV_BOOTSTRAP_ADMIN_PASSWORD) return;
  try {
    const [row] = await db().select({ c: count() }).from(users);
    if ((row?.c ?? 0) > 0) return;
    const result = await auth().api.signUpEmail({
      body: {
        email: e.SVUWV_BOOTSTRAP_ADMIN_EMAIL,
        password: e.SVUWV_BOOTSTRAP_ADMIN_PASSWORD,
        name: "Admin",
      },
    });
    if (result?.user?.id) {
      await db()
        .update(users)
        .set({ role: "admin", emailVerified: true })
        .where(eq(users.id, result.user.id));
      console.log(`[bootstrap] created admin user ${e.SVUWV_BOOTSTRAP_ADMIN_EMAIL}`);
    }
  } catch (err) {
    console.error("[bootstrap] failed:", (err as Error).message);
  }
}
