import { env } from "../src/server/env";

const e = env();

console.log("Derived from APP_SECRET via HKDF-SHA256:");
console.log();
console.log(`  better-auth signing secret : ${e.betterAuthSecret}`);
console.log(`  data encryption key (hex)  : ${e.dataEncryptionKey.toString("hex")}`);
console.log(`  SVUMS push HMAC secret     : ${e.svumsPushSecret}`);
console.log();
console.log("Share the SVUMS push secret with the SVUMS service so HMAC signatures match.");
