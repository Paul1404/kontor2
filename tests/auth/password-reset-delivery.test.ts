import { describe, expect, it } from "vitest";
import {
  observePasswordResetDelivery,
  recordPasswordResetDelivery,
} from "~/server/auth/password-reset-delivery";

describe("password reset delivery observation", () => {
  it("returns the hook delivery failure to the observing admin request", async () => {
    const observed = await observePasswordResetDelivery(async () => {
      recordPasswordResetDelivery({ ok: false, reason: "connection refused" });
      return "requested";
    });

    expect(observed).toEqual({
      value: "requested",
      delivery: { ok: false, reason: "connection refused" },
    });
  });

  it("does not leak results from public requests into a later admin request", async () => {
    recordPasswordResetDelivery({ ok: false, reason: "public failure" });

    const observed = await observePasswordResetDelivery(async () => "requested");

    expect(observed.delivery).toBeNull();
  });
});
