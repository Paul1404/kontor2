import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getSessionConfig } from "~/server/auth/session-config";
import { db } from "~/server/db/client";
import * as schema from "~/server/db/schema";
import { env } from "~/server/env";
import { redis } from "~/server/redis/client";

function buildAuth() {
  const sessionConfig = getSessionConfig();
  return betterAuth({
    baseURL: env().BETTER_AUTH_URL,
    secret: env().betterAuthSecret,
    database: drizzleAdapter(db(), {
      provider: "pg",
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      disableSignUp: true,
      minPasswordLength: 12,
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
      get: async (key) => (await redis().get(`auth:${key}`)) ?? null,
      set: async (key, value, ttl) => {
        if (ttl) await redis().set(`auth:${key}`, value, "EX", ttl);
        else await redis().set(`auth:${key}`, value);
      },
      delete: async (key) => {
        await redis().del(`auth:${key}`);
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
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    // `defaultRole` MUST be one of our `user_role` enum values: the admin
    // plugin's built-in default is "user", which is not in the enum and makes
    // every createUser insert fail with "invalid input value for enum
    // user_role". New users start as readonly and are promoted explicitly.
    plugins: [admin({ defaultRole: "readonly", adminRoles: ["admin"] }), tanstackStartCookies()],
  });
}

let authInstance: ReturnType<typeof buildAuth> | undefined;

export function auth(): ReturnType<typeof buildAuth> {
  if (!authInstance) authInstance = buildAuth();
  return authInstance;
}

/**
 * Drop the memoized instance so the next `auth()` call rebuilds better-auth.
 * Used after the session window changes (see session-config.ts) to apply the
 * new lifetime without a redeploy.
 */
export function invalidateAuth(): void {
  authInstance = undefined;
}

export type Session = NonNullable<
  Awaited<ReturnType<ReturnType<typeof auth>["api"]["getSession"]>>
>;
