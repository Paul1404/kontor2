import * as v from "valibot";
import { ORPCError } from "@orpc/server";
import { adminProc } from "~/server/orpc/base";
import { smtpConfigTable } from "~/server/db/schema/settings";
import { sendTestMail } from "~/server/auth/send-invite";
import { appendAudit, diff } from "~/server/audit/log";

const SmtpInput = v.object({
  host: v.pipe(v.string(), v.minLength(1)),
  port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
  secure: v.boolean(),
  requireTls: v.optional(v.boolean(), true),
  allowInvalidCerts: v.optional(v.boolean(), false),
  username: v.optional(v.nullable(v.string()), null),
  password: v.optional(v.nullable(v.string()), null),
  fromAddress: v.pipe(v.string(), v.email()),
  fromName: v.optional(v.nullable(v.string()), null),
});

export const settingsRouter = {
  getSmtp: adminProc.input(v.void()).handler(async ({ context }) => {
    const rows = await context.db.select().from(smtpConfigTable).limit(1);
    const row = rows[0];
    if (!row) return null;
    // Never return the decrypted password; UI only sees if a password is set.
    const { passwordEncrypted, ...rest } = row;
    return { ...rest, passwordSet: !!passwordEncrypted };
  }),

  updateSmtp: adminProc.input(SmtpInput).handler(async ({ context, input }) => {
    await context.db.transaction(async (tx) => {
      const existing = await tx.select().from(smtpConfigTable).limit(1);
      const next = {
        host: input.host,
        port: input.port,
        secure: input.secure,
        requireTls: input.requireTls,
        allowInvalidCerts: input.allowInvalidCerts,
        username: input.username,
        // `passwordEncrypted` is transparently encrypted/decrypted by the
        // Drizzle custom type, so `existing[0]?.passwordEncrypted` is
        // already plaintext on read; assigning it back triggers a fresh
        // encryption with a new IV on write.
        passwordEncrypted: input.password
          ? input.password
          : (existing[0]?.passwordEncrypted ?? null),
        fromAddress: input.fromAddress,
        fromName: input.fromName,
        updatedAt: new Date(),
        updatedBy: context.session!.user.id,
      };
      if (existing.length === 0) {
        await tx.insert(smtpConfigTable).values({ id: 1, ...next } as never);
      } else {
        await tx.update(smtpConfigTable).set(next as never);
      }

      // `passwordEncrypted` is in SECRET_COLUMNS in audit/log.ts so it
      // gets masked automatically — no special handling needed here.
      await appendAudit(tx, {
        entityType: "smtp_config",
        entityId: "1",
        action: existing.length === 0 ? "create" : "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: diff(existing[0] ?? null, next),
        requestId: context.requestId ?? null,
      });
    });
    return { ok: true };
  }),

  sendTestMail: adminProc
    .input(v.object({ to: v.pipe(v.string(), v.email()) }))
    .handler(async ({ input }) => {
      const result = await sendTestMail({ to: input.to });
      if (!result.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: `Versand fehlgeschlagen: ${result.reason}`,
        });
      }
      return { ok: true };
    }),
};
