import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { adminProc, authedProc, publicProc } from "~/server/orpc/base";
import { invitations, roleEnum, users } from "~/server/db/schema/auth";
import { auth } from "~/server/auth/auth";
import { sendInviteEmail } from "~/server/auth/send-invite";
import { env } from "~/server/env";

const RoleSchema = v.picklist(roleEnum.enumValues);

export const authRouter = {
  me: authedProc
    .input(v.void())
    .handler(async ({ context }) => ({
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
      await context.db
        .update(users)
        .set({ role: input.role, updatedAt: new Date() })
        .where(eq(users.id, input.userId));
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
      await context.db
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(eq(invitations.id, input.invitationId));
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
      if (inv.acceptedAt) throw new ORPCError("FORBIDDEN", { message: "Einladung bereits eingelöst." });
      if (inv.expiresAt < new Date()) throw new ORPCError("FORBIDDEN", { message: "Einladung abgelaufen." });
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
      const rows = await context.db
        .select()
        .from(invitations)
        .where(eq(invitations.token, input.token))
        .limit(1);
      const inv = rows[0];
      if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) {
        throw new ORPCError("FORBIDDEN", { message: "Einladung ungültig." });
      }
      const newUser = await auth().api.signUpEmail({
        body: { email: inv.email, password: input.password, name: input.name },
        headers: context.headers,
      });
      if (!newUser?.user?.id) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Konto konnte nicht angelegt werden." });
      }
      await context.db
        .update(users)
        .set({ role: inv.role, emailVerified: true })
        .where(eq(users.id, newUser.user.id));
      await context.db
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, inv.id));
      return { ok: true };
    }),
};
