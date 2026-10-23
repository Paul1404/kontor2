import { describe, expect, it } from "vitest";
import { createDevEnv } from "../../scripts/dev-env";

describe("development environment", () => {
  it("keeps inherited remote connection settings out of development commands", () => {
    const env = createDevEnv({
      DATABASE_URL: "postgres://remote.invalid/primary",
      CONTROL_DATABASE_URL: "postgres://remote.invalid/control",
      TENANTS_JSON: '[{"key":"other","databaseUrl":"postgres://remote.invalid/other"}]',
      REDIS_URL: "redis://remote.invalid",
      AWS_ENDPOINT_URL: "https://remote.invalid",
      BETTER_AUTH_URL: "https://remote.invalid",
      APP_SECRET: "existing-development-secret",
      PATH: "/tools",
    });
    for (const key of ["DATABASE_URL", "CONTROL_DATABASE_URL"]) {
      const url = new URL(env[key]!);
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.port).toBe("5434");
      expect(url.pathname).toBe("/kontor2_dev");
    }
    expect(env.TENANTS_JSON).toBe("");
    expect(new URL(env.REDIS_URL!).hostname).toBe("127.0.0.1");
    expect(new URL(env.AWS_ENDPOINT_URL!).hostname).toBe("127.0.0.1");
    expect(env.APP_SECRET).toBe("existing-development-secret");
    expect(env.PATH).toBe("/tools");
  });

  it("keeps the local origin aligned with an explicitly selected application port", () => {
    expect(createDevEnv({ PORT: "3301" }).BETTER_AUTH_URL).toBe("http://localhost:3301");
    expect(createDevEnv({}).BETTER_AUTH_URL).toBe("http://localhost:3000");
  });
});
