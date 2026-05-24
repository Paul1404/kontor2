import { count, eq } from "drizzle-orm";
import { auth } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { env } from "~/server/env";

let pending: Promise<void> | undefined;
let done = false;

/**
 * Creates a first admin user from `SVUWV_BOOTSTRAP_ADMIN_EMAIL` and
 * `SVUWV_BOOTSTRAP_ADMIN_PASSWORD` if the users table is empty. Runs at most
 * once per process; concurrent callers await the same in-flight promise.
 *
 * Uses the admin plugin's `createUser` endpoint rather than `signUpEmail` so
 * that bootstrap works even with `emailAndPassword.disableSignUp: true`.
 * Calling `auth.api.createUser` without `headers`/`request` skips the admin
 * session check (see `better-auth/dist/plugins/admin/routes.mjs`).
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  if (done) return;
  if (pending) return pending;
  pending = run().finally(() => {
    done = true;
    pending = undefined;
  });
  return pending;
}

async function run(): Promise<void> {
  const e = env();
  if (!e.SVUWV_BOOTSTRAP_ADMIN_EMAIL || !e.SVUWV_BOOTSTRAP_ADMIN_PASSWORD) return;
  try {
    const [row] = await db().select({ c: count() }).from(users);
    if ((row?.c ?? 0) > 0) return;
    const result = await auth().api.createUser({
      body: {
        email: e.SVUWV_BOOTSTRAP_ADMIN_EMAIL,
        password: e.SVUWV_BOOTSTRAP_ADMIN_PASSWORD,
        name: "Admin",
        role: "admin",
      },
    });
    if (result?.user?.id) {
      await db()
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, result.user.id));
      console.log(`[bootstrap] created admin user ${e.SVUWV_BOOTSTRAP_ADMIN_EMAIL}`);
    }
  } catch (err) {
    console.error("[bootstrap] failed:", (err as Error).message);
  }
}
