import { hkdfSync } from "node:crypto";
import * as v from "valibot";
import { type Keyring, makeKeyringEntry } from "~/server/crypto/encrypt";

const HEX_64 = /^[0-9a-fA-F]{64}$/;

const EnvSchema = v.object({
  NODE_ENV: v.optional(v.picklist(["development", "test", "production"]), "development"),
  PORT: v.optional(v.pipe(v.string(), v.transform(Number), v.number()), "3000"),

  DATABASE_URL: v.pipe(v.string(), v.minLength(1)),
  /**
   * Control-Plane-Datenbank (Betreiber-Console): hält die `tenants`-Registry und
   * (künftig) die Operator-Accounts, getrennt von allen Vereins-Daten. Wenn nicht
   * gesetzt, fällt alles auf `DATABASE_URL` zurück -- dann verhält sich die
   * Registry exakt wie bisher (Übergangs-Default).
   */
  CONTROL_DATABASE_URL: v.optional(v.string()),
  REDIS_URL: v.pipe(v.string(), v.minLength(1)),

  BETTER_AUTH_URL: v.pipe(v.string(), v.url()),
  /** One-time bootstrap capability for the primary tenant on a fresh install. */
  SETUP_BOOTSTRAP_TOKEN: v.optional(v.pipe(v.string(), v.minLength(32))),

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
  snapshotCronSecret: string;
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
    // KDF context labels are brand-namespaced (kontor2) and must stay stable:
    // changing one requires a re-encryption pass over the affected data (see
    // docs/key-rotation.md). `previous` holds the keys derived from any rotated
    // -out masters in APP_SECRET_PREV, so their ciphertext stays readable until
    // re-encrypted.
    const dataEncryptionKey = derive(master, "kontor2:data-encryption-key:v1");
    const previousMasters = parsePreviousSecrets(parsed.APP_SECRET_PREV);
    const previousDataKeys = previousMasters.map((m) =>
      derive(m, "kontor2:data-encryption-key:v1"),
    );
    const encryptionKeyring: Keyring = {
      current: makeKeyringEntry("current", dataEncryptionKey),
      previous: previousDataKeys.map((k, i) => makeKeyringEntry(`prev-${i}`, k)),
    };
    cached = {
      ...parsed,
      betterAuthSecret: derive(master, "kontor2:better-auth-secret:v1").toString("hex"),
      dataEncryptionKey,
      encryptionKeyring,
      snapshotCronSecret: derive(master, "kontor2:snapshot-cron-secret:v1").toString("hex"),
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

const DATA_KEY_LABEL = "kontor2:data-encryption-key:v1";
const tenantRingCache = new Map<string, Keyring>();

/**
 * Per-Verein-Verschlüsselungs-Keyring.
 *
 * Der Primär behält das unsuffixierte Label `kontor2:data-encryption-key:v1` --
 * SVU braucht damit KEIN Re-Key. Nicht-primäre Vereine leiten aus
 * `<label>:<tenantKey>` ab (eigener Schlüssel je Verein). Der Primär-Schlüssel
 * bleibt im `previous` des Tenant-Rings, damit
 *  - pre-Migration-Daten (vor dem Re-Key noch mit dem Primär-Schlüssel verschlüsselt) und
 *  - Schreibvorgänge über Nicht-ALS-Pfade (die den Default-/Primär-Ring nutzen)
 * weiterhin lesbar bleiben. Cross-Tenant bleibt isoliert: verein2s Ring kennt
 * verein3s Schlüssel nicht.
 */
export function tenantEncryptionKeyring(tenantKey: string): Keyring {
  const e = env(); // validiert + memoisiert; e.encryptionKeyring ist der Primär-Ring
  const primaryKey = process.env.PRIMARY_TENANT_KEY ?? "svu";
  if (tenantKey === primaryKey) return e.encryptionKeyring;

  const hit = tenantRingCache.get(tenantKey);
  if (hit) return hit;

  const master = Buffer.from(e.APP_SECRET, "hex");
  const prevMasters = parsePreviousSecrets(e.APP_SECRET_PREV);
  const label = `${DATA_KEY_LABEL}:${tenantKey}`;
  const ring: Keyring = {
    current: makeKeyringEntry("current", derive(master, label)),
    previous: [
      makeKeyringEntry("primary", derive(master, DATA_KEY_LABEL)),
      ...prevMasters.map((m, i) => makeKeyringEntry(`prev-${i}`, derive(m, label))),
      ...prevMasters.map((m, i) =>
        makeKeyringEntry(`prev-primary-${i}`, derive(m, DATA_KEY_LABEL)),
      ),
    ],
  };
  tenantRingCache.set(tenantKey, ring);
  return ring;
}

/** Test-only: clear the memoised env so a fresh `process.env` is re-read. */
export function _resetEnvCache(): void {
  cached = undefined;
  tenantRingCache.clear();
}
