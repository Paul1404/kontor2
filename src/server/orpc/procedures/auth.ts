import { createHash, randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, count, eq, ne, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { auth } from "~/server/auth/auth";
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
  setupStatus: publicProc.input(v.void()).handler(async () => {
    return { needsSetup: await isInSetupMode() };
  }),

  /**
   * Creates the first admin when the users table is empty. Idempotency-safe:
   * a second concurrent call sees the user table populated and refuses.
   * This is the recovery path for the "first-boot lockout" — operators who
   * deployed without SVUWV_BOOTSTRAP_ADMIN_* env vars use this instead of
   * having to edit env and restart the container.
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
      const result = await completeSetup(input);
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
      const url = `${env().BETTER_AUTH_URL}/invite/${token}`;
      const result = await sendInviteEmail({
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
          subject: "Einladung zur SVUWV Vereinsverwaltung",
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
          const created = await auth().api.createUser({
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
