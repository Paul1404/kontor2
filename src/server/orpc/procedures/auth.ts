import { createHash, randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { auth, authBaseUrl } from "~/server/auth/auth";
import { invitationStatus } from "~/server/auth/invitation-status";
import { wouldRemoveLastAdmin } from "~/server/auth/last-admin-guard";
import { sendInviteEmail } from "~/server/auth/send-invite";
import { completeSetup, isInSetupMode } from "~/server/auth/setup";
import { invitations, roleEnum, users } from "~/server/db/schema/auth";
import { env } from "~/server/env";
import { clientIp } from "~/server/lib/client-ip";
import { logger } from "~/server/lib/logger";
import { EMAIL_KIND, recordEmail, statusFromSend } from "~/server/mail/email-log";
import { adminProc, authedProc, publicProc } from "~/server/orpc/base";
import { rateLimit } from "~/server/redis/client";

/**
 * Throttle an unauthenticated, token-bearing endpoint by client IP. These
 * procedures (setup, invite lookup/acceptance) are guessing targets: the token
 * space is large, but rate limiting removes online brute force as an option and
 * caps abuse of the account-creation path. Throws TOO_MANY_REQUESTS when the
 * window is exhausted.
 */
async function throttle(headers: Headers, scope: string, limit: number): Promise<void> {
  const res = await rateLimit({
    key: `auth:${scope}:${clientIp(headers)}`,
    limit,
    windowSeconds: 300,
  });
  if (!res.allowed) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: "Zu viele Versuche. Bitte versuchen Sie es in einigen Minuten erneut.",
    });
  }
}

/** SHA-256 hex of the raw invite token; only the hash is persisted. */
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

const RoleSchema = v.picklist(roleEnum.enumValues);

export const authRouter = {
  /**
   * True when the users table is empty. The /setup route uses this to decide
   * whether to show the first-admin form or redirect to /login. Always
   * returns `false` once any user exists.
   */
  setupStatus: publicProc.input(v.void()).handler(async ({ context }) => {
    return { needsSetup: await isInSetupMode(context.tenant) };
  }),

  /**
   * Creates the first admin when the users table is empty. Idempotency-safe:
   * a second concurrent call sees the user table populated and refuses.
   * This is the only first-admin path: on a fresh instance you visit /setup
   * once and create it in the browser, with no secret in the environment.
   */
  completeSetup: publicProc
    .input(
      v.object({
        email: v.pipe(v.string(), v.email()),
        password: v.pipe(v.string(), v.minLength(12)),
        name: v.pipe(v.string(), v.minLength(1)),
      }),
    )
    .handler(async ({ context, input }) => {
      await throttle(context.headers, "setup", 10);
      const result = await completeSetup(context.tenant, input);
      if (!result.ok) {
        if (result.reason === "already_initialized") {
          throw new ORPCError("CONFLICT", {
            message: "Setup wurde bereits abgeschlossen. Bitte über /login anmelden.",
          });
        }
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: result.message ?? "Setup fehlgeschlagen.",
        });
      }
      return { ok: true };
    }),

  me: authedProc.input(v.void()).handler(async ({ context }) => ({
    id: context.session!.user.id,
    email: context.session!.user.email,
    name: context.session!.user.name,
    role: (context.session!.user.role as string) ?? "readonly",
  })),

  listUsers: adminProc.input(v.void()).handler(async ({ context }) => {
    const rows = await context.db.select().from(users);
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      banned: r.banned ?? false,
      createdAt: r.createdAt,
    }));
  }),

  setRole: adminProc
    .input(v.object({ userId: v.string(), role: RoleSchema }))
    .handler(async ({ context, input }) => {
      if (input.userId === context.session!.user.id) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Eigene Rolle kann nicht geändert werden.",
        });
      }
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ role: users.role, email: users.email })
          .from(users)
          .where(eq(users.id, input.userId))
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Benutzer nicht gefunden." });
        }
        if (existing.role === input.role) return;

        // Refuse the demotion if it would leave zero usable admins. We count
        // *other* admins (excluding the target) inside the same tx, and skip
        // banned ones: a banned admin can't act, so it must not keep the last
        // active admin demotable. Mirrors the better-auth last-admin guard.
        if (existing.role === "admin" && input.role !== "admin") {
          const [row] = await tx
            .select({ c: count() })
            .from(users)
            .where(
              and(eq(users.role, "admin"), ne(users.id, input.userId), eq(users.banned, false)),
            );
          if ((row?.c ?? 0) === 0) {
            throw new ORPCError("CONFLICT", {
              message: "Letzten Administrator kann nicht degradieren.",
            });
          }
        }

        await tx
          .update(users)
          .set({ role: input.role, updatedAt: new Date() })
          .where(eq(users.id, input.userId));

        await appendAudit(tx, {
          entityType: "user",
          entityId: input.userId,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            role: { before: existing.role, after: input.role },
            email: { before: existing.email, after: existing.email },
          },
          requestId: context.requestId ?? null,
        });
      });
      return { ok: true };
    }),

  /**
   * Permanently removes a user and everything keyed to them (sessions,
   * accounts, API keys, invitations they issued — all cascade in the schema).
   * Routed through the better-auth admin API rather than a direct Drizzle
   * delete on purpose: sessions live in Redis (secondary storage), so a raw
   * `delete from users` would cascade the database rows but leave the user's
   * Redis session valid until expiry. `removeUser` revokes those too.
   * Guards mirror `setRole`: never delete yourself, never delete the last
   * active admin.
   */
  deleteUser: adminProc
    .input(v.object({ userId: v.string() }))
    .handler(async ({ context, input }) => {
      if (input.userId === context.session!.user.id) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Eigenes Konto kann nicht gelöscht werden.",
        });
      }
      const [target] = await context.db
        .select({ email: users.email, role: users.role })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!target) {
        throw new ORPCError("NOT_FOUND", { message: "Benutzer nicht gefunden." });
      }
      if (await wouldRemoveLastAdmin(context.db, input.userId, "delete")) {
        throw new ORPCError("CONFLICT", {
          message:
            "Letzten Administrator kann nicht löschen. Bitte zuerst einen anderen Benutzer zum Administrator machen.",
        });
      }

      try {
        await auth(context.tenant).api.removeUser({
          body: { userId: input.userId },
          headers: context.headers,
        });
      } catch (err) {
        logger.error("auth.deleteUser.failed", {
          userId: input.userId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Benutzer konnte nicht gelöscht werden.",
        });
      }

      await appendAudit(context.db, {
        entityType: "user",
        entityId: input.userId,
        action: "delete",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          email: { before: target.email, after: null },
          role: { before: target.role, after: null },
        },
        requestId: context.requestId ?? null,
      });
      return { ok: true };
    }),

  /**
   * Bans a user: blocks new logins and revokes existing sessions (the latter
   * is why this goes through the better-auth admin API and not a raw column
   * update). A banned account is kept, just locked, and can be unbanned. Same
   * guards as a demotion: not yourself, not the last active admin.
   */
  banUser: adminProc
    .input(
      v.object({
        userId: v.string(),
        reason: v.optional(v.pipe(v.string(), v.maxLength(500))),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.userId === context.session!.user.id) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Eigenes Konto kann nicht gesperrt werden.",
        });
      }
      const [target] = await context.db
        .select({ email: users.email, banned: users.banned })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!target) {
        throw new ORPCError("NOT_FOUND", { message: "Benutzer nicht gefunden." });
      }
      if (await wouldRemoveLastAdmin(context.db, input.userId, "ban")) {
        throw new ORPCError("CONFLICT", {
          message:
            "Letzten aktiven Administrator kann nicht sperren. Bitte zuerst einen anderen Benutzer zum Administrator machen.",
        });
      }

      const reason = input.reason?.trim();
      try {
        await auth(context.tenant).api.banUser({
          body: { userId: input.userId, ...(reason ? { banReason: reason } : {}) },
          headers: context.headers,
        });
      } catch (err) {
        logger.error("auth.banUser.failed", {
          userId: input.userId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Benutzer konnte nicht gesperrt werden.",
        });
      }

      await appendAudit(context.db, {
        entityType: "user",
        entityId: input.userId,
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          banned: { before: target.banned ?? false, after: true },
          banReason: { before: null, after: reason ?? null },
        },
        requestId: context.requestId ?? null,
      });
      return { ok: true };
    }),

  /** Lifts a ban. Safe by definition, so no last-admin guard. */
  unbanUser: adminProc
    .input(v.object({ userId: v.string() }))
    .handler(async ({ context, input }) => {
      const [target] = await context.db
        .select({ email: users.email, banned: users.banned })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!target) {
        throw new ORPCError("NOT_FOUND", { message: "Benutzer nicht gefunden." });
      }

      try {
        await auth(context.tenant).api.unbanUser({
          body: { userId: input.userId },
          headers: context.headers,
        });
      } catch (err) {
        logger.error("auth.unbanUser.failed", {
          userId: input.userId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Sperre konnte nicht aufgehoben werden.",
        });
      }

      await appendAudit(context.db, {
        entityType: "user",
        entityId: input.userId,
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: { banned: { before: target.banned ?? false, after: false } },
        requestId: context.requestId ?? null,
      });
      return { ok: true };
    }),

  /**
   * Force-logout: revokes all of a user's sessions (DB rows and the Redis
   * secondary-storage copies) so the next request from any of their devices
   * requires a fresh login. The user keeps their account and role. Allowed on
   * yourself too — a deliberate "sign out everywhere".
   */
  revokeUserSessions: adminProc
    .input(v.object({ userId: v.string() }))
    .handler(async ({ context, input }) => {
      const [target] = await context.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!target) {
        throw new ORPCError("NOT_FOUND", { message: "Benutzer nicht gefunden." });
      }

      try {
        await auth(context.tenant).api.revokeUserSessions({
          body: { userId: input.userId },
          headers: context.headers,
        });
      } catch (err) {
        logger.error("auth.revokeUserSessions.failed", {
          userId: input.userId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Sitzungen konnten nicht beendet werden.",
        });
      }

      await appendAudit(context.db, {
        entityType: "user",
        entityId: input.userId,
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: { sessionsRevoked: { before: null, after: true } },
        requestId: context.requestId ?? null,
      });
      return { ok: true };
    }),

  /**
   * Admin password reset: sets a freshly generated temporary password and
   * returns it ONCE so the admin can hand it to a locked-out colleague. The
   * password itself is never persisted in the audit log (only the fact that a
   * reset happened). Sessions are revoked so any old, possibly compromised
   * login is cut off and the user must sign in with the new password.
   */
  resetUserPassword: adminProc
    .input(v.object({ userId: v.string() }))
    .handler(async ({ context, input }) => {
      const [target] = await context.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!target) {
        throw new ORPCError("NOT_FOUND", { message: "Benutzer nicht gefunden." });
      }

      // base64url of 18 random bytes -> 24 url-safe chars, comfortably above
      // the 12-char minimum and high entropy.
      const tempPassword = randomBytes(18).toString("base64url");
      try {
        await auth(context.tenant).api.setUserPassword({
          body: { userId: input.userId, newPassword: tempPassword },
          headers: context.headers,
        });
        await auth(context.tenant).api.revokeUserSessions({
          body: { userId: input.userId },
          headers: context.headers,
        });
      } catch (err) {
        logger.error("auth.resetUserPassword.failed", {
          userId: input.userId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Passwort konnte nicht zurückgesetzt werden.",
        });
      }

      await appendAudit(context.db, {
        entityType: "user",
        entityId: input.userId,
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: { passwordReset: { before: null, after: true } },
        requestId: context.requestId ?? null,
      });
      return { email: target.email, tempPassword };
    }),

  invite: adminProc
    .input(v.object({ email: v.pipe(v.string(), v.email()), role: RoleSchema }))
    .handler(async ({ context, input }) => {
      const token = randomBytes(32).toString("base64url");
      const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      const [inv] = await context.db
        .insert(invitations)
        .values({
          id: crypto.randomUUID(),
          // Store only the hash; the raw token lives in the emailed URL alone.
          tokenHash: sha256(token),
          email: input.email.toLowerCase(),
          role: input.role,
          invitedBy: context.session!.user.id,
          expiresAt: expires,
        })
        .returning();
      const url = `${authBaseUrl(context.tenant)}/invite/${token}`;
      const result = await sendInviteEmail(context.db, {
        to: input.email,
        acceptUrl: url,
        invitedByName: context.session!.user.name ?? context.session!.user.email,
        role: input.role,
      });
      await recordEmail(
        {
          kind: EMAIL_KIND.invite,
          ...statusFromSend(result),
          recipient: input.email,
          subject: result.subject,
          entityType: "invitation",
          entityId: inv!.id,
          actorEmail: context.session!.user.email,
          requestId: context.requestId ?? null,
        },
        context.db,
      );

      await appendAudit(context.db, {
        entityType: "invitation",
        entityId: inv!.id,
        action: "create",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          email: { before: null, after: input.email.toLowerCase() },
          role: { before: null, after: input.role },
          emailSent: { before: null, after: result.ok },
        },
        requestId: context.requestId ?? null,
      });

      return {
        invitationId: inv!.id,
        emailSent: result.ok,
        emailError: result.ok ? null : result.reason,
        expiresAt: expires,
      };
    }),

  revokeInvite: adminProc
    .input(v.object({ invitationId: v.string() }))
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ email: invitations.email, revokedAt: invitations.revokedAt })
          .from(invitations)
          .where(eq(invitations.id, input.invitationId))
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Einladung nicht gefunden." });
        }
        if (existing.revokedAt) return;

        await tx
          .update(invitations)
          .set({ revokedAt: new Date() })
          .where(eq(invitations.id, input.invitationId));

        await appendAudit(tx, {
          entityType: "invitation",
          entityId: input.invitationId,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            revokedAt: { before: null, after: new Date().toISOString() },
            email: { before: existing.email, after: existing.email },
          },
          requestId: context.requestId ?? null,
        });
      });
      return { ok: true };
    }),

  /**
   * All invites with a derived status, newest first. Backs the "Offene
   * Einladungen" list on the Benutzer page so an admin can see who has a
   * pending invite and revoke it (the email-only `invite` flow otherwise
   * leaves no trace in the UI).
   */
  listInvitations: adminProc.input(v.void()).handler(async ({ context }) => {
    const rows = await context.db.select().from(invitations).orderBy(desc(invitations.createdAt));
    const now = new Date();
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      status: invitationStatus(r, now),
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
    }));
  }),

  /** Used by the /invite/:token page to fetch invite details before submit. */
  getInvitation: publicProc
    .input(v.object({ token: v.string() }))
    .handler(async ({ context, input }) => {
      await throttle(context.headers, "invite-lookup", 20);
      const rows = await context.db
        .select()
        .from(invitations)
        .where(eq(invitations.tokenHash, sha256(input.token)))
        .limit(1);
      const inv = rows[0];
      if (!inv) throw new ORPCError("NOT_FOUND", { message: "Einladung nicht gefunden." });
      if (inv.revokedAt) throw new ORPCError("FORBIDDEN", { message: "Einladung widerrufen." });
      if (inv.acceptedAt)
        throw new ORPCError("FORBIDDEN", { message: "Einladung bereits eingelöst." });
      if (inv.expiresAt < new Date())
        throw new ORPCError("FORBIDDEN", { message: "Einladung abgelaufen." });
      return { email: inv.email, role: inv.role };
    }),

  acceptInvitation: publicProc
    .input(
      v.object({
        token: v.string(),
        name: v.pipe(v.string(), v.minLength(1)),
        password: v.pipe(v.string(), v.minLength(12)),
      }),
    )
    .handler(async ({ context, input }) => {
      await throttle(context.headers, "invite-accept", 10);
      // Atomically mark the invitation accepted with a conditional update.
      // If 0 rows change, another request already accepted/revoked it (or
      // it expired) — fail without creating the user. This sidesteps the
      // classic check-then-act race.
      const claimed = await context.db
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(invitations.tokenHash, sha256(input.token)),
            sql`accepted_at is null`,
            sql`revoked_at is null`,
            sql`expires_at > now()`,
          ),
        )
        .returning({
          id: invitations.id,
          email: invitations.email,
          role: invitations.role,
        });
      const inv = claimed[0];
      if (!inv) {
        throw new ORPCError("FORBIDDEN", { message: "Einladung ungültig." });
      }

      // Self-healing path: a prior attempt may have created the better-auth
      // user but failed mid-flight before the role update / audit insert
      // landed. On retry, the invitation has been rolled back (acceptedAt
      // = null again) so we get past the claim, but `createUser` would throw
      // "email already in use" forever. Detect that case and complete the
      // role update on the existing orphan user instead.
      try {
        // Bootstrap uses `createUser` (admin API) because `signUpEmail`
        // honours `disableSignUp: true` in the auth config. Same reason
        // here: invited users must be created via the admin API.
        //
        // Role is intentionally omitted: the admin plugin is configured with
        // `defaultRole: "readonly"` (a valid `user_role` enum value), so the
        // insert succeeds. We then overwrite to the real Verein role
        // (`readonly` / `vorstand` / `admin`) in the follow-up update below.
        let userId: string;
        try {
          const created = await auth(context.tenant).api.createUser({
            body: {
              email: inv.email,
              password: input.password,
              name: input.name,
            },
          });
          if (!created?.user?.id) {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: "Konto konnte nicht angelegt werden.",
            });
          }
          userId = created.user.id;
        } catch (createErr) {
          // Look for the "email already exists" signal. better-auth surfaces
          // this as a thrown APIError with a status / code; match loosely on
          // the message to cover phrasing changes between versions.
          const msg = (createErr as Error).message ?? "";
          const looksLikeDup = /already\s*(in\s*use|exists)|user.*exist/i.test(msg);
          if (!looksLikeDup) throw createErr;

          const [orphan] = await context.db
            .select({ id: users.id, role: users.role })
            .from(users)
            .where(eq(users.email, inv.email.toLowerCase()))
            .limit(1);
          if (!orphan) {
            // The duplicate signal was misleading — surface the original error.
            throw createErr;
          }
          // Only adopt the orphan if it's still on the default role. A user
          // with a real role already accepted earlier; we don't overwrite
          // their state.
          if (orphan.role !== "readonly") {
            throw new ORPCError("CONFLICT", {
              message:
                "Für diese E-Mail existiert bereits ein Benutzer. Bitte über /login anmelden.",
            });
          }
          userId = orphan.id;
          logger.info("invite.adopt-orphan", {
            userId,
            invitationId: inv.id,
            note: "retry after partial failure",
          });
        }

        await context.db
          .update(users)
          .set({ role: inv.role, emailVerified: true })
          .where(eq(users.id, userId));

        await appendAudit(context.db, {
          entityType: "user",
          entityId: userId,
          action: "create",
          source: "ui",
          actorId: null,
          actorEmail: inv.email,
          changes: {
            email: { before: null, after: inv.email },
            role: { before: null, after: inv.role },
            invitationId: { before: null, after: inv.id },
          },
          requestId: context.requestId ?? null,
        });
      } catch (e) {
        // Roll back the invitation claim so the user can retry (or admin
        // can re-issue). Best-effort: log if even the rollback fails.
        try {
          await context.db
            .update(invitations)
            .set({ acceptedAt: null })
            .where(eq(invitations.id, inv.id));
        } catch (rollbackError) {
          logger.error("invite.rollback-failed", {
            invitationId: inv.id,
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          });
        }
        throw e;
      }

      return { ok: true };
    }),
};
