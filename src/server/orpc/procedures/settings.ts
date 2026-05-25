import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { appendAudit, diff } from "~/server/audit/log";
import { sendTestMail } from "~/server/auth/send-invite";
import { inspectEncryptedData, reencryptAllData } from "~/server/crypto/reencrypt";
import { smtpConfigTable } from "~/server/db/schema/settings";
import { adminProc } from "~/server/orpc/base";

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

  /**
   * Send a test mail. When `inline` is provided, use it directly instead of
   * the DB-persisted config — lets admins try a new SMTP config without
   * saving it first (sidesteps the catch-22 of "save broken config to test it").
   */
  sendTestMail: adminProc
    .input(
      v.object({
        to: v.pipe(v.string(), v.email()),
        inline: v.optional(
          v.nullable(
            v.object({
              host: v.pipe(v.string(), v.minLength(1)),
              port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
              secure: v.boolean(),
              requireTls: v.optional(v.boolean(), true),
              allowInvalidCerts: v.optional(v.boolean(), false),
              username: v.optional(v.nullable(v.string()), null),
              password: v.optional(v.nullable(v.string()), null),
              fromAddress: v.pipe(v.string(), v.email()),
              fromName: v.optional(v.nullable(v.string()), null),
            }),
          ),
          null,
        ),
      }),
    )
    .handler(async ({ input }) => {
      const result = await sendTestMail({ to: input.to, inline: input.inline ?? null });
      if (!result.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: `Versand fehlgeschlagen: ${result.reason}`,
        });
      }
      return { ok: true };
    }),

  /**
   * Inspect how many encrypted rows live on which key (current vs previous
   * vs legacy single-key v1). Used by the rotation UI to preview the impact
   * before running `reencryptData`.
   */
  inspectEncryption: adminProc.input(v.void()).handler(async ({ context }) => {
    return inspectEncryptedData(context.db);
  }),

  /**
   * Re-encrypt every encrypted bytea column under the current keyring key.
   * Idempotent; rows already on the current key are skipped via a cheap
   * fingerprint check. Rows whose key is not in the keyring are reported as
   * `failed` and left intact, so an operator can add the missing key to
   * APP_SECRET_PREV and retry.
   */
  reencryptData: adminProc.input(v.void()).handler(async ({ context }) => {
    const report = await reencryptAllData(context.db);
    const totals = report.reduce(
      (acc, r) => ({
        scanned: acc.scanned + r.scanned,
        rewritten: acc.rewritten + r.rewritten,
        failed: acc.failed + r.failed,
      }),
      { scanned: 0, rewritten: 0, failed: 0 },
    );
    await appendAudit(context.db, {
      entityType: "encryption",
      entityId: "reencrypt",
      action: "update",
      source: "system",
      actorId: context.session!.user.id,
      actorEmail: context.session!.user.email,
      changes: {
        scanned: { before: null, after: totals.scanned },
        rewritten: { before: null, after: totals.rewritten },
        failed: { before: null, after: totals.failed },
      },
      requestId: context.requestId ?? null,
    });
    return { report, totals };
  }),
};
