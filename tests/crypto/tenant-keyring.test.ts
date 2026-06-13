import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWithKeyring } from "~/server/crypto/active-keyring";
import {
  _resetDecryptFailureCount,
  encryptString,
  inspectCiphertext,
  safeDecrypt,
} from "~/server/crypto/encrypt";
import { runWithTenantKeyring } from "~/server/crypto/tenant-crypto";
import { _resetEnvCache, env, tenantEncryptionKeyring } from "~/server/env";

/**
 * Per-Verein-Keyring (C2b): SVU (Primär) bleibt unverändert, jeder Nicht-Primär
 * leitet einen EIGENEN Schlüssel ab. Der Primär-Schlüssel bleibt im `previous`
 * (liest pre-Migration-Daten), Cross-Tenant ist isoliert, und ein außerhalb des
 * aktiven Keyrings gelesener Verein-Ciphertext entschlüsselt NICHT (-> null).
 */
const FULL_ENV: Record<string, string> = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_URL: "http://localhost:3000",
  APP_SECRET: "a".repeat(64),
  AWS_ENDPOINT_URL: "http://localhost:9000",
  AWS_S3_BUCKET_NAME: "bucket",
  AWS_DEFAULT_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "key",
  AWS_SECRET_ACCESS_KEY: "secret",
};

describe("per-tenant keyring", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    for (const [k, v] of Object.entries(FULL_ENV)) process.env[k] = v;
    delete process.env.APP_SECRET_PREV;
    delete process.env.PRIMARY_TENANT_KEY; // Primär = "svu"
    _resetEnvCache();
    _resetDecryptFailureCount();
  });
  afterEach(() => {
    process.env = { ...saved };
    _resetEnvCache();
  });

  it("gibt für den Primär den unveränderten env-Ring zurück", () => {
    expect(tenantEncryptionKeyring("svu")).toBe(env().encryptionKeyring);
  });

  it("leitet je Nicht-Primär einen eigenen Schlüssel ab; Primär bleibt lesbar; Cross-Tenant isoliert", () => {
    const primaryFp = env().encryptionKeyring.current.fingerprint;
    const v2 = tenantEncryptionKeyring("verein2");
    const v3 = tenantEncryptionKeyring("verein3");

    expect(v2.current.fingerprint.equals(primaryFp)).toBe(false); // eigener Schlüssel
    expect(v2.previous.some((k) => k.fingerprint.equals(primaryFp))).toBe(true); // Primär lesbar
    expect(v2.current.fingerprint.equals(v3.current.fingerprint)).toBe(false); // je Verein verschieden
    expect(v2.previous.some((k) => k.fingerprint.equals(v3.current.fingerprint))).toBe(false); // v2 kennt v3 nicht
  });

  it("verschlüsselt im aktiven Verein-Keyring und isoliert gegen Default + andere Vereine", () => {
    const blob = runWithTenantKeyring("verein2", () => encryptString("DE12500105170648489890"));
    expect(inspectCiphertext(blob)?.version).toBe(2);

    // Im verein2-Kontext lesbar.
    expect(runWithTenantKeyring("verein2", () => safeDecrypt(blob))).toBe("DE12500105170648489890");
    // Ohne aktiven Keyring (Default = Primär) NICHT lesbar.
    expect(safeDecrypt(blob)).toBeNull();
    // Unter einem anderen Verein NICHT lesbar.
    expect(runWithTenantKeyring("verein3", () => safeDecrypt(blob))).toBeNull();
  });

  it("liest Primär-verschlüsselte Daten auch im Verein-Keyring (Sicherheitsnetz)", () => {
    const primaryBlob = encryptString("DE89370400440532013000"); // Default = Primär
    expect(runWithTenantKeyring("verein2", () => safeDecrypt(primaryBlob))).toBe(
      "DE89370400440532013000",
    );
  });

  it("runWithKeyring schachtelt und stellt den äußeren Keyring wieder her", () => {
    const v2 = tenantEncryptionKeyring("verein2");
    const blob = runWithTenantKeyring("verein2", () => {
      // verschachtelter Primär-Block ändert den äußeren Kontext nicht
      runWithKeyring(env().encryptionKeyring, () => encryptString("inner"));
      return encryptString("outer");
    });
    // "outer" wurde mit dem verein2-Schlüssel verschlüsselt
    const fp = inspectCiphertext(blob);
    expect(fp?.version === 2 && fp.fingerprint.equals(v2.current.fingerprint)).toBe(true);
  });
});
