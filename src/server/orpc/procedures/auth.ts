import { randomBytes } from "node:crypto";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { adminProc, authedProc, publicProc } from "~/server/orpc/base";
import { invitations, roleEnum, users } from "~/server/db/schema/auth";
import { auth } from "~/server/auth/auth";
import { sendInviteEmail } from "~/server/auth/send-invite";
import { appendAudit } from "~/server/audit/log";
import { env } from "~/server/env";

const RoleSchema = v.picklist(roleEnum.enumValues);

export const authRouter = {
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

        // Refuse the demotion if it would leave zero admins. We check
        // *other* admins (excluding the target user) inside the same tx.
        if (existing.role === "admin" && input.role !== "admin") {
          const [row] = await tx
            .select({ c: count() })
            .from(users)
            .where(and(eq(users.role, "admin"), ne(users.id, input.userId)));
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
          token,
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
      const rows = await context.db
        .select()
        .from(invitations)
        .where(eq(invitations.token, input.token))
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
      // Atomically mark the invitation accepted with a conditional update.
      // If 0 rows change, another request already accepted/revoked it (or
      // it expired) — fail without creating the user. This sidesteps the
      // classic check-then-act race.
      const claimed = await context.db
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(invitations.token, input.token),
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

      try {
        // Bootstrap uses `createUser` (admin API) because `signUpEmail`
        // honours `disableSignUp: true` in the auth config. Same reason
        // here: invited users must be created via the admin API.
        //
        // The admin plugin's `createUser.body.role` enum is only the
        // built-in `"user" | "admin"`, so we always pass "user" here and
        // overwrite to our real Verein role (`readonly` / `vorstand` /
        // `admin`) in the follow-up update below.
        const created = await auth().api.createUser({
          body: {
            email: inv.email,
            password: input.password,
            name: input.name,
            role: "user",
          },
        });
        if (!created?.user?.id) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Konto konnte nicht angelegt werden.",
          });
        }
        await context.db
          .update(users)
          .set({ role: inv.role, emailVerified: true })
          .where(eq(users.id, created.user.id));

        await appendAudit(context.db, {
          entityType: "user",
          entityId: created.user.id,
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
          console.error("[invite] failed to roll back claim:", rollbackError);
        }
        throw e;
      }

      return { ok: true };
    }),
};
