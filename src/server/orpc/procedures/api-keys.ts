import { ORPCError } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { auth } from "~/server/auth/auth";
import { apikeys, users } from "~/server/db/schema";
import { adminProc } from "~/server/orpc/base";

/**
 * Admin management of MCP API keys (Einstellungen -> KI-Zugriff). Keys are
 * issued via the better-auth api-key plugin (hashed at rest); the plaintext
 * is returned exactly once from `create`. A key acts with the role of the
 * user it is bound to, so the admin picks the user (and thereby the role)
 * when creating a key.
 */
export const apiKeysRouter = {
  list: adminProc.input(v.void()).handler(async ({ context }) => {
    const rows = await context.db
      .select({
        id: apikeys.id,
        name: apikeys.name,
        start: apikeys.start,
        enabled: apikeys.enabled,
        expiresAt: apikeys.expiresAt,
        lastRequest: apikeys.lastRequest,
        createdAt: apikeys.createdAt,
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        userRole: users.role,
      })
      .from(apikeys)
      .innerJoin(users, eq(apikeys.referenceId, users.id))
      .orderBy(desc(apikeys.createdAt));
    return rows;
  }),

  create: adminProc
    .input(
      v.object({
        name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(32)),
        userId: v.string(),
        expiresInDays: v.optional(
          v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365))),
          null,
        ),
      }),
    )
    .handler(async ({ context, input }) => {
      const [owner] = await context.db
        .select({ id: users.id, email: users.email, banned: users.banned })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!owner) {
        throw new ORPCError("NOT_FOUND", { message: "Benutzer nicht gefunden." });
      }
      if (owner.banned) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Für gesperrte Benutzer können keine Schlüssel erstellt werden.",
        });
      }

      // Server-side call: no request/headers passed, so the plugin accepts
      // `userId` as the key owner (a client-shaped call would reject it).
      const created = await auth().api.createApiKey({
        body: {
          name: input.name,
          userId: input.userId,
          expiresIn: input.expiresInDays ? input.expiresInDays * 24 * 60 * 60 : null,
        },
      });

      await appendAudit(context.db, {
        entityType: "apiKey",
        entityId: created.id,
        action: "create",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          name: { before: null, after: input.name },
          owner: { before: null, after: owner.email },
        },
        requestId: context.requestId,
      });

      // `created.key` is the plaintext, shown to the admin exactly once.
      return {
        id: created.id,
        key: created.key,
        name: created.name,
        start: created.start,
        expiresAt: created.expiresAt,
      };
    }),

  revoke: adminProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    // Direct delete instead of auth.api.deleteApiKey: the plugin endpoint
    // only lets the key's own user delete it, but here an admin revokes
    // keys of any user. This procedure is admin-gated, so that is fine.
    const [removed] = await context.db
      .delete(apikeys)
      .where(eq(apikeys.id, input.id))
      .returning({ id: apikeys.id, name: apikeys.name });
    if (!removed) {
      throw new ORPCError("NOT_FOUND", { message: "Schlüssel nicht gefunden." });
    }

    await appendAudit(context.db, {
      entityType: "apiKey",
      entityId: removed.id,
      action: "delete",
      source: "ui",
      actorId: context.session!.user.id,
      actorEmail: context.session!.user.email,
      changes: { name: { before: removed.name, after: null } },
      requestId: context.requestId,
    });

    return { ok: true };
  }),
};
