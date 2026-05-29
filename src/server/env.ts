import { hkdfSync } from "node:crypto";
import * as v from "valibot";
import { type Keyring, makeKeyringEntry } from "~/server/crypto/encrypt";

const HEX_64 = /^[0-9a-fA-F]{64}$/;

const EnvSchema = v.object({
  NODE_ENV: v.optional(v.picklist(["development", "test", "production"]), "development"),
  PORT: v.optional(v.pipe(v.string(), v.transform(Number), v.number()), "3000"),

  DATABASE_URL: v.pipe(v.string(), v.minLength(1)),
  REDIS_URL: v.pipe(v.string(), v.minLength(1)),

  BETTER_AUTH_URL: v.pipe(v.string(), v.url()),

  APP_SECRET: v.pipe(
    v.string(),
    v.regex(HEX_64, "must be 64 hex chars (32 bytes), generate with `openssl rand -hex 32`"),
  ),

  /**
   * Previous APP_SECRETs, comma-separated. During a rotation, set this to the
   * old secret(s); the keyring will accept old ciphertexts via fingerprint
   * lookup (v2) or by trying each key (v1). After running
   * `settings.reencryptData`, this can be removed.
   */
  APP_SECRET_PREV: v.optional(v.string()),

  AWS_ENDPOINT_URL: v.pipe(v.string(), v.url()),
  AWS_S3_BUCKET_NAME: v.pipe(v.string(), v.minLength(1)),
  AWS_DEFAULT_REGION: v.pipe(v.string(), v.minLength(1)),
  AWS_ACCESS_KEY_ID: v.pipe(v.string(), v.minLength(1)),
  AWS_SECRET_ACCESS_KEY: v.pipe(v.string(), v.minLength(1)),

  SVUWV_BOOTSTRAP_ADMIN_EMAIL: v.optional(v.string()),
  SVUWV_BOOTSTRAP_ADMIN_PASSWORD: v.optional(v.string()),

  // Disable the in-process nightly snapshot scheduler. Useful for local
  // dev or when triggering the run externally (e.g. via Railway Cron and
  // the HMAC-protected `/api/cron/snapshots` route).
  SNAPSHOT_CRON_DISABLED: v.optional(v.picklist(["0", "1"]), "0"),
});

type RawEnv = v.InferOutput<typeof EnvSchema>;

export type Env = RawEnv & {
  betterAuthSecret: string;
  /** Active AES-256-GCM key for new encryptions. */
  dataEncryptionKey: Buffer;
  /** Full keyring (current + any rotated-out keys still readable). */
  encryptionKeyring: Keyring;
  svumsPushSecret: string;
};

function derive(master: Buffer, info: string, length = 32): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), info, length));
}

function parsePreviousSecrets(raw: string | undefined): Buffer[] {
  if (!raw) return [];
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const p of parts) {
    if (!HEX_64.test(p)) {
      throw new Error(
        `APP_SECRET_PREV entry "${p.slice(0, 8)}…" is not 64 hex chars; expected the same shape as APP_SECRET`,
      );
    }
  }
  return parts.map((p) => Buffer.from(p, "hex"));
}

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  try {
    const parsed = v.parse(EnvSchema, process.env);
    const master = Buffer.from(parsed.APP_SECRET, "hex");
    const dataEncryptionKey = derive(master, "svuwv:data-encryption-key:v1");
    const previousMasters = parsePreviousSecrets(parsed.APP_SECRET_PREV);
    const previousDataKeys = previousMasters.map((m) => derive(m, "svuwv:data-encryption-key:v1"));
    const encryptionKeyring: Keyring = {
      current: makeKeyringEntry("current", dataEncryptionKey),
      previous: previousDataKeys.map((k, i) => makeKeyringEntry(`prev-${i}`, k)),
    };
    cached = {
      ...parsed,
      betterAuthSecret: derive(master, "svuwv:better-auth-secret:v1").toString("hex"),
      dataEncryptionKey,
      encryptionKeyring,
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

/** Test-only: clear the memoised env so a fresh `process.env` is re-read. */
export function _resetEnvCache(): void {
  cached = undefined;
}
