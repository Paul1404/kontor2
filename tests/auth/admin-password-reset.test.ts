import { describe, expect, it, vi } from "vitest";
import { revokeThenSetPassword } from "~/server/auth/admin-password-reset";

describe("admin temporary-password reset", () => {
  it("does not change the password when session revocation fails", async () => {
    const setPassword = vi.fn(async () => undefined);

    await expect(
      revokeThenSetPassword(async () => {
        throw new Error("redis unavailable");
      }, setPassword),
    ).rejects.toThrow("redis unavailable");
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("sets the password only after sessions were revoked", async () => {
    const calls: string[] = [];
    await revokeThenSetPassword(
      async () => calls.push("revoke"),
      async () => calls.push("set"),
    );
    expect(calls).toEqual(["revoke", "set"]);
  });
});
