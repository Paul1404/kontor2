import { ORPCError, os } from "@orpc/server";
import type { Role } from "~/server/db/schema/auth";
import { logger } from "~/server/lib/logger";
import type { AppContext } from "~/server/orpc/context";
import { isOperatorTenant } from "~/server/tenants/resolve";

export const base = os.$context<AppContext>();

/**
 * Pull the loggable shape out of a thrown value. Beyond the top-level message
 * we walk the `cause` chain, because the messages that actually explain a
 * failure usually hide one level down: Drizzle wraps the driver error in a
 * `DrizzleQueryError` whose own message is only "Failed query: select ...",
 * while the real reason ("column ... does not exist") and the Postgres SQLSTATE
 * sit on the wrapped pg error in `.cause`. Without unwrapping, `rpc.failed`
 * logs the SQL but never the reason, which is exactly what made a broken
 * `feeRuns.preview` undiagnosable from the deploy logs.
 *
 * We surface the deepest cause message and any SQLSTATE `code`, but not the pg
 * `detail`/`hint` fields, which can echo row values.
 */
export function errorLogFields(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { error: String(err) };
  const fields: Record<string, unknown> = { error: err.message };

  const topCode = (err as { code?: unknown }).code;
  if (typeof topCode === "string") fields.pgCode = topCode;

  let cause: unknown = err.cause;
  for (let depth = 0; cause instanceof Error && depth < 5; depth += 1) {
    fields.cause = cause.message;
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string") fields.pgCode = code;
    cause = cause.cause;
  }
  return fields;
}

/**
 * Outermost middleware on every procedure: times the call and logs its
 * outcome once, with the request id. Expected client-facing failures
 * (`ORPCError`, e.g. UNAUTHORIZED / NOT_FOUND) log at warn without a stack;
 * anything else is an unexpected server fault and logs at error. This is the
 * single place RPC errors are logged, so procedures don't have to. Apply it to
 * every procedure entrypoint via `base.use(observability)`.
 */
export const observability = base.middleware(async ({ context, path, next }) => {
  const proc = path.join(".");
  const { requestId } = context;
  const start = performance.now();
  try {
    const result = await next();
    logger.info("rpc.ok", { proc, requestId, ms: Math.round(performance.now() - start) });
    return result;
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    if (err instanceof ORPCError) {
      logger.warn("rpc.rejected", { proc, requestId, ms, code: err.code });
    } else {
      logger.error("rpc.failed", { proc, requestId, ms, ...errorLogFields(err) });
    }
    throw err;
  }
});

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

/**
 * Betreiber-Console-Gate: nur Accounts des Operator-Realms (Control-DB, Host
 * `admin.<domain>`) mit Admin-Rolle. Vereins-Admins können hier NICHTS -- die
 * Console ist eine eigene Welt, getrennt von jedem Verein. Ein Verein hat keine
 * Macht über andere.
 */
export const requireOperator = base.middleware(async ({ context, next }) => {
  if (!isOperatorTenant(context.tenant)) {
    throw new ORPCError("FORBIDDEN", { message: "Nur im Betreiber-Bereich verfügbar." });
  }
  return next();
});

export const publicProc = base.use(observability);
export const authedProc = base.use(observability).use(requireAuth("readonly"));
export const vorstandProc = base.use(observability).use(requireAuth("vorstand"));
export const adminProc = base.use(observability).use(requireAuth("admin"));
export const operatorProc = base.use(observability).use(requireAuth("admin")).use(requireOperator);
