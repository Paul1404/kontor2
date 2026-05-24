import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "~/server/db/client";
import { env } from "~/server/env";
import * as schema from "~/server/db/schema";
import { redis } from "~/server/redis/client";

function buildAuth() {
  return betterAuth({
    baseURL: env().BETTER_AUTH_URL,
    secret: env().BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), {
      provider: "pg",
      usePlural: true,
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
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
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    plugins: [admin(), tanstackStartCookies()],
  });
}

let authInstance: ReturnType<typeof buildAuth> | undefined;

export function auth(): ReturnType<typeof buildAuth> {
  if (!authInstance) authInstance = buildAuth();
  return authInstance;
}

export type Session = NonNullable<Awaited<ReturnType<ReturnType<typeof auth>["api"]["getSession"]>>>;
