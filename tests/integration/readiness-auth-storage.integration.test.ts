import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { handleHealth } from "~/routes/api/health";
import { auth } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { _resetEnvCache } from "~/server/env";
import { redis } from "~/server/redis/client";

const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const email = "upgrade-auth@test.local";

describe.skipIf(!onTestDb)("readiness and upgraded authentication", () => {
  afterAll(async () => {
    vi.unstubAllEnvs();
    _resetEnvCache();
    await db().delete(users).where(eq(users.email, email));
    await redis().del("auth:upgrade-counter", "auth:upgrade-once");
  });

  it("reports healthy dependencies, outages and recovery without caching or details", async () => {
    expect((await handleHealth()).status).toBe(200);
    for (const key of ["DATABASE_URL", "CONTROL_DATABASE_URL", "REDIS_URL"]) {
      vi.stubEnv(key, key === "REDIS_URL" ? "redis://127.0.0.1:1" : "postgres://127.0.0.1:1/test");
      _resetEnvCache();
      const response = await handleHealth();
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).not.toContain("127.0.0.1");
      vi.unstubAllEnvs();
      _resetEnvCache();
      expect((await handleHealth()).status).toBe(200);
    }
  });

  it("consumes one-time values once and increments concurrently without extending expiry", async () => {
    const storage = auth().options.secondaryStorage!;
    await storage.set("upgrade-once", "value", 30);
    const values = await Promise.all(
      Array.from({ length: 10 }, () => storage.getAndDelete("upgrade-once")),
    );
    expect(values.filter((value) => value === "value")).toHaveLength(1);
    await redis().del("auth:upgrade-counter");
    const counts = await Promise.all(
      Array.from({ length: 20 }, () => storage.increment("upgrade-counter", 30)),
    );
    expect(new Set(counts).size).toBe(20);
    await redis().expire("auth:upgrade-counter", 10);
    expect(await storage.increment("upgrade-counter", 30)).toBe(21);
    expect(await redis().ttl("auth:upgrade-counter")).toBeLessThanOrEqual(10);
    await storage.set("upgrade-counter", JSON.stringify({ count: 7, lastRequest: Date.now() }), 10);
    expect(await storage.increment("upgrade-counter", 30)).toBe(8);
    expect(await redis().ttl("auth:upgrade-counter")).toBeLessThanOrEqual(10);
  });

  it("signs in an existing credential account and revokes its Redis session on sign-out", async () => {
    const instance = auth();
    await instance.api.createUser({
      body: {
        name: "Upgrade Test",
        email,
        password: "test-password-for-upgrade",
        role: "admin",
      },
    });
    // createUser chooses its own ID. Keep cleanup tied to the actual row.
    const [owner] = await db().select().from(users).where(eq(users.email, email));
    expect(owner).toBeDefined();
    try {
      const headers = new Headers();
      const response = await instance.api.signInEmail({
        body: { email, password: "test-password-for-upgrade" },
        asResponse: true,
      });
      headers.set(
        "cookie",
        response.headers
          .getSetCookie()
          .map((cookie) => cookie.split(";")[0])
          .join("; "),
      );
      expect((await instance.api.getSession({ headers }))?.user.id).toBe(owner!.id);
      await instance.api.signOut({ headers });
      expect(await instance.api.getSession({ headers })).toBeNull();
    } finally {
      await db().delete(users).where(eq(users.email, email));
    }
  });
});
