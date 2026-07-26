import type { SnapshotResult } from "~/server/snapshots/scheduler";

/** Build the public cron response without exposing raw tenant error messages. */
export function snapshotCronResponse(result: SnapshotResult): Response {
  const failed = result.failures.length > 0;
  return Response.json(
    {
      ok: !failed,
      acquiredLock: result.acquiredLock,
      runId: result.runId,
      memberCount: result.memberCount,
      skippedCount: result.skippedCount,
      bytesTotal: result.bytesTotal,
      tenants: result.tenants,
      failedTenants: result.failures.map((failure) => failure.tenant),
    },
    { status: failed ? 503 : 200 },
  );
}
