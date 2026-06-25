import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { appendAudit, diff } from "~/server/audit/log";
import { invalidateAuth } from "~/server/auth/auth";
import { sendTestMail } from "~/server/auth/send-invite";
import {
  SESSION_DEFAULTS,
  SESSION_LIMITS,
  setSessionConfigCache,
} from "~/server/auth/session-config";
import { inspectEncryptedData, reencryptAllData } from "~/server/crypto/reencrypt";
import { authSettingsTable, smtpConfigTable } from "~/server/db/schema/settings";
import { EMAIL_KIND, recordEmail, statusFromSend } from "~/server/mail/email-log";
import { adminProc } from "~/server/orpc/base";

const SessionSettingsInput = v.object({
  sessionExpiresInDays: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(SESSION_LIMITS.expiresInDays.min),
    v.maxValue(SESSION_LIMITS.expiresInDays.max),
  ),
  sessionUpdateAgeHours: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(SESSION_LIMITS.updateAgeHours.min),
    v.maxValue(SESSION_LIMITS.updateAgeHours.max),
  ),
});

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
  /** Current session window. Falls back to defaults when no row exists yet. */
  getSessionSettings: adminProc.input(v.void()).handler(async ({ context }) => {
    const [row] = await context.db.select().from(authSettingsTable).limit(1);
    return {
      sessionExpiresInDays: row?.sessionExpiresInDays ?? SESSION_DEFAULTS.expiresInDays,
      sessionUpdateAgeHours: row?.sessionUpdateAgeHours ?? SESSION_DEFAULTS.updateAgeHours,
      limits: SESSION_LIMITS,
    };
  }),

  updateSessionSettings: adminProc
    .input(SessionSettingsInput)
    .handler(async ({ context, input }) => {
      // A refresh interval longer than the lifetime would never fire, so the
      // session would silently never extend. Reject that combination.
      if (input.sessionUpdateAgeHours > input.sessionExpiresInDays * 24) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Verlängerungsintervall darf die Sitzungsdauer nicht überschreiten.",
        });
      }
      await context.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(authSettingsTable).limit(1);
        const next = {
          sessionExpiresInDays: input.sessionExpiresInDays,
          sessionUpdateAgeHours: input.sessionUpdateAgeHours,
          updatedAt: new Date(),
          updatedBy: context.session!.user.id,
        };
        if (!existing) {
          await tx.insert(authSettingsTable).values({ id: 1, ...next });
        } else {
          await tx.update(authSettingsTable).set(next);
        }
        await appendAudit(tx, {
          entityType: "auth_settings",
          entityId: "1",
          action: existing ? "update" : "create",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: diff(existing ?? null, next),
          requestId: context.requestId ?? null,
        });
      });
      // Apply live: refresh the in-memory cache and drop the memoized auth
      // instance so the next request rebuilds better-auth with the new window.
      setSessionConfigCache(context.tenant.key, {
        expiresInDays: input.sessionExpiresInDays,
        updateAgeHours: input.sessionUpdateAgeHours,
      });
      invalidateAuth();
      return { ok: true };
    }),

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
    .handler(async ({ context, input }) => {
      const result = await sendTestMail(context.db, { to: input.to, inline: input.inline ?? null });
      await recordEmail(
        {
          kind: EMAIL_KIND.testMail,
          ...statusFromSend(result),
          recipient: input.to,
          subject: result.subject,
          actorEmail: context.session!.user.email,
          requestId: context.requestId ?? null,
        },
        context.db,
      );
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
