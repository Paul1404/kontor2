import { describe, expect, it } from "vitest";
import { createSandboxCredentials, sandboxPort } from "../../scripts/sandbox";
import { createTestEnv } from "../../scripts/test-env";

describe("sandbox launcher", () => {
  it("generates fresh, valid throwaway admin credentials", () => {
    const first = createSandboxCredentials();
    const second = createSandboxCredentials();

    expect(first.name).toBe("Sandbox Admin");
    expect(first.email).toMatch(/^sandbox-[a-f0-9]{12}@example\.test$/);
    expect(first.password.length).toBeGreaterThanOrEqual(12);
    expect(second.email).not.toBe(first.email);
    expect(second.password).not.toBe(first.password);
  });

  it("uses port 3100 by default and accepts a safe override", () => {
    expect(sandboxPort(undefined)).toBe(3100);
    expect(sandboxPort("4310")).toBe(4310);
    expect(() => sandboxPort("80")).toThrow(/1024/);
    expect(() => sandboxPort("invalid")).toThrow(/1024/);
  });

  it("points auth at the sandbox URL", () => {
    expect(createTestEnv("http://localhost:4310").BETTER_AUTH_URL).toBe("http://localhost:4310");
  });
});
