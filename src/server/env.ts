import * as v from "valibot";

const EnvSchema = v.object({
  NODE_ENV: v.optional(v.picklist(["development", "test", "production"]), "development"),
  PORT: v.optional(v.pipe(v.string(), v.transform(Number), v.number()), "3000"),

  DATABASE_URL: v.pipe(v.string(), v.minLength(1)),
  REDIS_URL: v.pipe(v.string(), v.minLength(1)),

  BETTER_AUTH_URL: v.pipe(v.string(), v.url()),
  BETTER_AUTH_SECRET: v.pipe(v.string(), v.minLength(32)),
  DATA_ENCRYPTION_KEY: v.pipe(v.string(), v.regex(/^[0-9a-fA-F]{64}$/)),

  AWS_ENDPOINT_URL: v.pipe(v.string(), v.url()),
  AWS_S3_BUCKET_NAME: v.pipe(v.string(), v.minLength(1)),
  AWS_DEFAULT_REGION: v.pipe(v.string(), v.minLength(1)),
  AWS_ACCESS_KEY_ID: v.pipe(v.string(), v.minLength(1)),
  AWS_SECRET_ACCESS_KEY: v.pipe(v.string(), v.minLength(1)),

  SVUMS_PUSH_SECRET: v.pipe(v.string(), v.minLength(16)),

  SVUWV_BOOTSTRAP_ADMIN_EMAIL: v.optional(v.string()),
  SVUWV_BOOTSTRAP_ADMIN_PASSWORD: v.optional(v.string()),
});

export type Env = v.InferOutput<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  try {
    cached = v.parse(EnvSchema, process.env);
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
