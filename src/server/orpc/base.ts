import { ORPCError, os } from "@orpc/server";
import type { Role } from "~/server/db/schema/auth";
import type { AppContext } from "~/server/orpc/context";

export const base = os.$context<AppContext>();

const ROLE_RANK: Record<Role, number> = { readonly: 1, vorstand: 2, admin: 3 };

/**
 * Require an authenticated session, optionally with a minimum role.
 * `admin` ⊃ `vorstand` ⊃ `readonly`.
 */
export function requireAuth(min: Role = "readonly") {
  return base.middleware(async ({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED", { message: "Anmeldung erforderlich." });
    }
    const role = (context.session.user.role as Role | undefined) ?? "readonly";
    if (ROLE_RANK[role] < ROLE_RANK[min]) {
      throw new ORPCError("FORBIDDEN", {
        message: `Rolle '${min}' oder höher erforderlich.`,
      });
    }
    return next({
      context: {
        ...context,
        user: context.session.user,
        role,
      },
    });
  });
}

export const publicProc = base;
export const authedProc = base.use(requireAuth("readonly"));
export const vorstandProc = base.use(requireAuth("vorstand"));
export const adminProc = base.use(requireAuth("admin"));
