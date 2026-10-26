import { runWithTenantKeyring } from "~/server/crypto/tenant-crypto";
import { logger } from "~/server/lib/logger";
import { runBirthdayReminders } from "~/server/mail/birthday-reminders";
import { tenantHandles } from "~/server/snapshots/scheduler";

let timer: ReturnType<typeof setInterval> | null = null;
let active: Promise<void> | null = null;
export function startBirthdayScheduler() {
  if (timer || process.env.SNAPSHOT_CRON_DISABLED === "1") return;
  const run = () => {
    if (active) return;
    active = (async () => {
      for (const tenant of await tenantHandles())
        try {
          await runWithTenantKeyring(tenant.key, () => runBirthdayReminders(tenant.handle));
        } catch (error) {
          logger.error("birthday reminder failed", {
            tenant: tenant.key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
    })()
      .catch((error) => logger.error("birthday scheduler failed", { error: String(error) }))
      .finally(() => {
        active = null;
      });
  };
  timer = setInterval(run, 60_000);
  timer.unref();
  run();
}
export async function stopBirthdayScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  await active;
}
