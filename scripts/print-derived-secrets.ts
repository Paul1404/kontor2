import { writeFile } from "node:fs/promises";
import { env, tenantSvumsPushSecret } from "../src/server/env";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }),
);

const purpose = args.get("purpose") ?? "svums-ingest";
const out = args.get("out");
const tenant = args.get("tenant");

if (!out || (purpose === "svums-ingest" && !tenant)) {
  console.error(
    "Usage: bun scripts/print-derived-secrets.ts --purpose=svums-ingest --tenant=<key> --out=<new-file>\n" +
      "   or: bun scripts/print-derived-secrets.ts --purpose=snapshot-cron --out=<new-file>",
  );
  process.exit(2);
}

const secret =
  purpose === "svums-ingest"
    ? tenantSvumsPushSecret(tenant!)
    : purpose === "snapshot-cron"
      ? env().snapshotCronSecret
      : null;

if (!secret) {
  console.error("Unknown purpose. Use svums-ingest or snapshot-cron.");
  process.exit(2);
}

// Never place credentials in stdout, shell history, or an existing file. The
// operator can transfer this mode-0600 file through the platform's secret store
// and delete it immediately afterward.
await writeFile(out, `${secret}\n`, { mode: 0o600, flag: "wx" });
console.log(`Credential written to ${out} with mode 0600. Delete it after provisioning.`);
