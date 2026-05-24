import { customType } from "drizzle-orm/pg-core";
import { decryptToString, encryptString } from "~/server/crypto/encrypt";

/**
 * Bytea column that transparently encrypts string values with AES-256-GCM.
 * Use for IBANs, SMTP password, and any other secret-at-rest field.
 */
export const encryptedText = customType<{ data: string; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: string): Buffer {
    return encryptString(value);
  },
  fromDriver(value: Buffer): string {
    return decryptToString(value);
  },
});
