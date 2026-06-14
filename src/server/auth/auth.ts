import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { sendPasswordResetEmail } from "~/server/auth/send-invite";
import { getSessionConfig } from "~/server/auth/session-config";
import { db, dbForTenant } from "~/server/db/client";
import * as schema from "~/server/db/schema";
import { env } from "~/server/env";
import { logger } from "~/server/lib/logger";
import { EMAIL_KIND, recordEmail, statusFromSend } from "~/server/mail/email-log";
import { redis } from "~/server/redis/client";
import type { Tenant } from "~/server/tenants/registry";
import { primaryTenant, productDomain } from "~/server/tenants/resolve";

/**
 * The auth-facing base URL for a Verein: the primary keeps its configured
 * BETTER_AUTH_URL (unchanged for SVU); every other Verein lives at
 * `https://<key>.<product-domain>`. Used for links the app builds itself.
 */
export function authBaseUrl(tenant: Tenant): string {
  return tenant.key === primaryTenant().key
    ? env().BETTER_AUTH_URL
    : `https://${tenant.key}.${productDomain()}`;
}

function buildAuth(tenant: Tenant) {
  const sessionConfig = getSessionConfig();
  const baseURL = authBaseUrl(tenant);
  const isPrimary = tenant.key === primaryTenant().key;
  // The primary Verein's database is always the process DATABASE_URL pool
  // (db()), independent of the tenant object's url field; every other Verein
  // gets its own pool. Redis session namespace likewise: the primary keeps the
  // historical `auth:` prefix so existing SVU sessions stay valid.
  const tenantDb = isPrimary ? db() : dbForTenant(tenant.databaseUrl);
  const keyPrefix = isPrimary ? "auth:" : `auth:${tenant.key}:`;
  return betterAuth({
    baseURL,
    secret: env().betterAuthSecret,
    // Always trust the primary's configured URL (keeps SVU valid regardless of
    // the tenant logic), plus this tenant's base, plus any same-product-domain
    // subdomain origin (so each Verein's own subdomain is accepted).
    trustedOrigins: (request) => {
      const trusted = [env().BETTER_AUTH_URL, baseURL];
      const origin = request?.headers.get("origin");
      if (origin) {
        try {
          const host = new URL(origin).hostname;
          if (host === productDomain() || host.endsWith(`.${productDomain()}`)) {
            trusted.push(origin);
          }
        } catch {
          /* ignore malformed Origin header */
        }
      }
      return trusted;
    },
    database: drizzleAdapter(tenantDb, {
      provider: "pg",
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
        apikeys: schema.apikeys,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      disableSignUp: true,
      minPasswordLength: 12,
      // Self-service password reset. better-auth issues the token; we mail a
      // link to our own /passwort-zuruecksetzen route (not better-auth's URL)
      // so the flow stays inside the app. The send is best-effort and never
      // throws: a thrown sender would turn the public request-reset endpoint
      // into an email-enumeration oracle (configured vs. unconfigured SMTP,
      // existing vs. missing user). Every attempt is recorded in the mail log.
      sendResetPassword: async ({ user, token }) => {
        const resetUrl = `${baseURL}/passwort-zuruecksetzen?token=${token}`;
        const result = await sendPasswordResetEmail(tenantDb, { to: user.email, resetUrl });
        if (!result.ok && result.reason !== "smtp_not_configured") {
          logger.warn("auth.password-reset.send-failed", { reason: result.reason });
        }
        await recordEmail({
          kind: EMAIL_KIND.passwordReset,
          ...statusFromSend(result),
          recipient: user.email,
          subject: "Passwort zurücksetzen",
          entityType: "user",
          entityId: user.id,
        });
      },
      // One hour, matching better-auth's default; stated explicitly so the
      // mail copy ("eine Stunde gültig") cannot drift from the real window.
      resetPasswordTokenExpiresIn: 60 * 60,
    },
    // Brute-force protection. Without this the credential login endpoint
    // accepts unlimited guesses against a known email. Rate-limit records live
    // in the same Redis we use for sessions (`secondary-storage`), so this
    // works across container instances and survives a redeploy. Enabled in
    // production only; dev/test would otherwise throttle the test suite and
    // local iteration. Keying is per client IP (see `advanced.ipAddress`).
    rateLimit: {
      enabled: env().NODE_ENV === "production",
      storage: "secondary-storage",
      // Generous global default so normal browsing of auth endpoints (session
      // refresh, get-session) is never throttled.
      window: 60,
      max: 120,
      customRules: {
        // The expensive, attackable endpoints: credential sign-in and the
        // password-reset request. 10 attempts per 5 minutes per IP is well
        // above a human mistyping a password and far below a useful brute
        // force.
        "/sign-in/email": { window: 300, max: 10 },
        "/forget-password": { window: 300, max: 5 },
        "/reset-password": { window: 300, max: 10 },
      },
    },
    advanced: {
      // Railway terminates TLS and forwards the real client IP in
      // `x-forwarded-for`. Pin the rate limiter (and session IP tracking) to
      // that header so throttling keys on the visitor, not the proxy.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "readonly",
          input: false,
        },
      },
    },
    secondaryStorage: {
      get: async (key) => (await redis().get(`${keyPrefix}${key}`)) ?? null,
      set: async (key, value, ttl) => {
        if (ttl) await redis().set(`${keyPrefix}${key}`, value, "EX", ttl);
        else await redis().set(`${keyPrefix}${key}`, value);
      },
      delete: async (key) => {
        await redis().del(`${keyPrefix}${key}`);
      },
    },
    session: {
      // Sliding window whose length is admin-configurable (Benutzer page ->
      // session-config.ts). As long as the user is active within `expiresIn`
      // the session keeps getting extended, so a Vorstand who logs in a few
      // times a month effectively stays signed in. `updateAge` refreshes the
      // window once per interval of activity. Defaults: 90-day lifetime,
      // refreshed once per day.
      expiresIn: sessionConfig.expiresInDays * 24 * 60 * 60,
      updateAge: sessionConfig.updateAgeHours * 60 * 60,
      // Cookie cache deliberately OFF: with it on, getSession reads the user's
      // role and banned flag from a signed cookie for up to its maxAge, so a
      // ban, role demotion or forced logout would only take effect minutes
      // later (a demoted admin could keep acting as admin in the meantime).
      // The app validates the session once per request in createContext, so a
      // store lookup per request is the correct trade for immediate effect.
      cookieCache: { enabled: false },
    },
    // `defaultRole` MUST be one of our `user_role` enum values: the admin
    // plugin's built-in default is "user", which is not in the enum and makes
    // every createUser insert fail with "invalid input value for enum
    // user_role". New users start as readonly and are promoted explicitly.
    plugins: [
      admin({ defaultRole: "readonly", adminRoles: ["admin"] }),
      // API keys for the MCP endpoint (/api/mcp). `enableSessionForAPIKeys`
      // stays at its false default on purpose: keys are only honored where we
      // verify them explicitly (the MCP route), never as a session for the
      // whole app or better-auth's own endpoints.
      //
      // The plugin's own rate limit is deliberately NOT used as the real
      // throttle: when it trips, `verifyApiKey` returns `valid: false`, which
      // the route can only surface as a 401 — telling an AI client to
      // re-authenticate when it should back off. So the ceiling is raised to
      // effectively unlimited (the plugin still tracks `lastRequest` for the
      // KI-Zugriff UI) and the real per-key limit lives in
      // `src/server/mcp/rate-limit.ts`, where a breach returns a proper 429 +
      // Retry-After. See issues #77 and #82.
      apiKey({
        apiKeyHeaders: "x-api-key",
        defaultPrefix: "kontor2_",
        enableMetadata: true,
        rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 1_000_000 },
      }),
      // MUST remain the last plugin (cookie handling in TanStack Start).
      tanstackStartCookies(),
    ],
  });
}

// One memoized better-auth instance per Verein (keyed by tenant key); each binds
// that Verein's database, base URL and Redis namespace.
const instances = new Map<string, ReturnType<typeof buildAuth>>();

export function auth(tenant: Tenant = primaryTenant()): ReturnType<typeof buildAuth> {
  let instance = instances.get(tenant.key);
  if (!instance) {
    instance = buildAuth(tenant);
    instances.set(tenant.key, instance);
  }
  return instance;
}

/**
 * Drop all memoized instances so the next `auth()` call rebuilds better-auth.
 * Used after the session window changes (see session-config.ts) to apply the
 * new lifetime without a redeploy.
 */
export function invalidateAuth(): void {
  instances.clear();
}

export type Session = NonNullable<
  Awaited<ReturnType<ReturnType<typeof auth>["api"]["getSession"]>>
>;
