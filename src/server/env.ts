import { hkdfSync } from "node:crypto";
import * as v from "valibot";

const EnvSchema = v.object({
  NODE_ENV: v.optional(v.picklist(["development", "test", "production"]), "development"),
  PORT: v.optional(v.pipe(v.string(), v.transform(Number), v.number()), "3000"),

  DATABASE_URL: v.pipe(v.string(), v.minLength(1)),
  REDIS_URL: v.pipe(v.string(), v.minLength(1)),

  BETTER_AUTH_URL: v.pipe(v.string(), v.url()),

  APP_SECRET: v.pipe(
    v.string(),
    v.regex(
      /^[0-9a-fA-F]{64}$/,
      "must be 64 hex chars (32 bytes), generate with `openssl rand -hex 32`",
    ),
  ),

  AWS_ENDPOINT_URL: v.pipe(v.string(), v.url()),
  AWS_S3_BUCKET_NAME: v.pipe(v.string(), v.minLength(1)),
  AWS_DEFAULT_REGION: v.pipe(v.string(), v.minLength(1)),
  AWS_ACCESS_KEY_ID: v.pipe(v.string(), v.minLength(1)),
  AWS_SECRET_ACCESS_KEY: v.pipe(v.string(), v.minLength(1)),

  SVUWV_BOOTSTRAP_ADMIN_EMAIL: v.optional(v.string()),
  SVUWV_BOOTSTRAP_ADMIN_PASSWORD: v.optional(v.string()),
});

type RawEnv = v.InferOutput<typeof EnvSchema>;

export type Env = RawEnv & {
  betterAuthSecret: string;
  dataEncryptionKey: Buffer;
  svumsPushSecret: string;
};

function derive(master: Buffer, info: string, length = 32): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), info, length));
}

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  try {
    const parsed = v.parse(EnvSchema, process.env);
    const master = Buffer.from(parsed.APP_SECRET, "hex");
    cached = {
      ...parsed,
      betterAuthSecret: derive(master, "svuwv:better-auth-secret:v1").toString("hex"),
      dataEncryptionKey: derive(master, "svuwv:data-encryption-key:v1"),
      svumsPushSecret: derive(master, "svuwv:svums-push-secret:v1").toString("hex"),
    };
    return cached;
  } catch (err) {
    if (v.isValiError(err)) {
      const issues = err.issues
        .map((i) => `  ${i.path?.map((p) => p.key).join(".") ?? "?"}: ${i.message}`)
        .join("\n");
      console.error(`[env] invalid environment:\n${issues}`);
    }
    throw err;
  }
}
