import { describe, expect, it } from "vitest";
import { redactFields } from "~/server/lib/logger";

describe("redactFields", () => {
  it("redacts sensitive top-level keys", () => {
    const out = redactFields({
      proc: "members.list",
      password: "hunter2",
      APP_SECRET: "deadbeef",
      authorization: "Bearer x",
      cookie: "session=abc",
    });
    expect(out.proc).toBe("members.list");
    expect(out.password).toBe("[redacted]");
    expect(out.APP_SECRET).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect(out.cookie).toBe("[redacted]");
  });

  it("matches sensitive substrings case-insensitively", () => {
    const out = redactFields({
      databaseUrl: "postgres://u:p@host/db",
      redis_url: "redis://host",
      memberIban1: "DE00",
      bic: "GENODEF1",
      apiKey: "k",
    });
    expect(out.databaseUrl).toBe("[redacted]");
    expect(out.redis_url).toBe("[redacted]");
    expect(out.memberIban1).toBe("[redacted]");
    expect(out.bic).toBe("[redacted]");
    expect(out.apiKey).toBe("[redacted]");
  });

  it("recurses into nested objects", () => {
    const out = redactFields({
      member: { id: "abc", iban1: "DE00", name: "Anonym" },
    });
    expect(out.member).toEqual({ id: "abc", iban1: "[redacted]", name: "Anonym" });
  });

  it("leaves non-sensitive primitives, dates and arrays intact", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const out = redactFields({ count: 3, ok: true, when: now, ids: ["a", "b"] });
    expect(out.count).toBe(3);
    expect(out.ok).toBe(true);
    expect(out.when).toBe(now);
    expect(out.ids).toEqual(["a", "b"]);
  });
});
