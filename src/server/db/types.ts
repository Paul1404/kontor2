import { customType } from "drizzle-orm/pg-core";
import { encryptString, safeDecrypt } from "~/server/crypto/encrypt";

/**
 * Bytea column that transparently encrypts string values with AES-256-GCM.
 * Use for IBANs, SMTP password, and any other secret-at-rest field.
 *
 * Reads go through `safeDecrypt`: a row whose ciphertext cannot be decrypted
 * (e.g. the active keyring no longer holds the key it was written with) reads
 * back as an empty string instead of throwing. Throwing here aborts the whole
 * SELECT during driver deserialization, which would brick member lists, the
 * org settings, SMTP config, fee runs, and DSGVO tooling all at once and leave
 * no way to reach the re-encrypt repair. Failing soft keeps the app usable so
 * the operator can restore `APP_SECRET_PREV` and re-encrypt. The failure is
 * logged (with backoff) by `safeDecrypt`.
 */
export const encryptedText = customType<{ data: string; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: string): Buffer {
    return encryptString(value);
  },
  fromDriver(value: Buffer): string {
    return safeDecrypt(value) ?? "";
  },
});
