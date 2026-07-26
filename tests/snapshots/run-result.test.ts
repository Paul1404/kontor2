import { describe, expect, it } from "vitest";
import { snapshotCronResponse } from "~/server/snapshots/cron-response";
import { runTenantSnapshotBatch } from "~/server/snapshots/scheduler";

describe("tenant snapshot batch", () => {
  it("retains successful tenant results and reports per-tenant failures", async () => {
    const result = await runTenantSnapshotBatch(
      [{ key: "svu" }, { key: "broken" }, { key: "verein2" }],
      async (tenant) => {
        if (tenant.key === "broken") throw new Error("database unavailable");
        return {
          runId: `${tenant.key}-run`,
          memberCount: 2,
          skippedCount: 3,
          bytesTotal: 100,
          acquiredLock: true,
        };
      },
    );

    expect(result.failures).toEqual([{ tenant: "broken", error: "database unavailable" }]);
    expect(result.tenants.map((tenant) => tenant.tenant)).toEqual(["svu", "verein2"]);
    expect(result.memberCount).toBe(4);
    expect(result.skippedCount).toBe(6);
    expect(result.bytesTotal).toBe(200);
  });

  it("returns a non-success cron response without leaking error details", async () => {
    const result = await runTenantSnapshotBatch([{ key: "broken" }], async () => {
      throw new Error("secret database detail");
    });
    const response = snapshotCronResponse(result);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ ok: false, failedTenants: ["broken"], tenants: [] });
    expect(JSON.stringify(body)).not.toContain("secret database detail");
  });

  it("returns success when every tenant completed", async () => {
    const result = await runTenantSnapshotBatch([{ key: "svu" }], async () => ({
      runId: "run-1",
      memberCount: 1,
      skippedCount: 0,
      bytesTotal: 50,
      acquiredLock: true,
    }));

    expect(snapshotCronResponse(result).status).toBe(200);
  });
});
