import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import { idempotencyKeysTable } from "~/server/db/schema/idempotency";

/**
 * Run a create operation at most once per `(scope, key)` (issue #83).
 *
 * The key is reserved via an insert with `onConflictDoNothing`: the first call
 * wins, runs the operation and stores its JSON result. A retry with the same
 * key finds the completed row and returns the stored result instead of creating
 * a second record. A key that was reserved but never completed (a crash
 * mid-flight, or a genuinely concurrent in-flight call) yields a CONFLICT so the
 * caller can retry later rather than silently double-create.
 *
 * No key supplied => run normally (idempotency is opt-in per call).
 */
export async function withIdempotency<T>(
  db: DB,
  scope: string,
  key: string | null | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (!key) return run();

  const [reserved] = await db
    .insert(idempotencyKeysTable)
    .values({ scope, key })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeysTable.id });

  if (!reserved) {
    const [existing] = await db
      .select()
      .from(idempotencyKeysTable)
      .where(and(eq(idempotencyKeysTable.scope, scope), eq(idempotencyKeysTable.key, key)))
      .limit(1);
    if (existing?.completedAt && existing.result != null) {
      return existing.result as T;
    }
    throw new ORPCError("CONFLICT", {
      message: "Anfrage mit diesem Idempotency-Key wird bereits verarbeitet.",
    });
  }

  let result: T;
  try {
    result = await run();
  } catch (err) {
    // The operation failed, so release the reservation instead of leaving an
    // incomplete row. Otherwise every retry with the same key would hit the
    // CONFLICT branch above forever, permanently bricking the key.
    await db
      .delete(idempotencyKeysTable)
      .where(eq(idempotencyKeysTable.id, reserved.id))
      .catch(() => {});
    throw err;
  }
  await db
    .update(idempotencyKeysTable)
    .set({ result: result as unknown as Record<string, unknown>, completedAt: new Date() })
    .where(eq(idempotencyKeysTable.id, reserved.id));
  return result;
}
