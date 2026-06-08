import { afterEach, describe, expect, it, vi } from "vitest";
import { type LogRecord, logger, redactFields, registerSink } from "~/server/lib/logger";

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

describe("logger sinks", () => {
  // The console sink prints during these tests; silence it so the suite output
  // stays clean. We assert on the registered test sink, not on the console.
  afterEach(() => vi.restoreAllMocks());

  function capture(name: string, minLevel?: LogRecord["level"]) {
    const records: LogRecord[] = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const off = registerSink({ name, minLevel, write: (r) => records.push(r) });
    return { records, off };
  }

  it("dispatches a record to a registered sink with timestamp and level", () => {
    const { records, off } = capture("test-dispatch");
    logger.info("hello", { proc: "members.list" });
    off();
    expect(records).toHaveLength(1);
    const rec = records[0]!;
    expect(rec.level).toBe("info");
    expect(rec.message).toBe("hello");
    expect(rec.time).toBeInstanceOf(Date);
    expect(rec.fields).toMatchObject({ proc: "members.list" });
  });

  it("merges child bindings into every record", () => {
    const { records, off } = capture("test-child");
    const scoped = logger.child({ requestId: "req-1" });
    scoped.warn("scoped", { extra: 1 });
    off();
    expect(records[0]!.fields).toMatchObject({ requestId: "req-1", extra: 1 });
  });

  it("redacts secrets before the record reaches a sink", () => {
    const { records, off } = capture("test-redact");
    logger.error("auth failed", { password: "hunter2", user: "a" });
    off();
    expect(records[0]!.fields.password).toBe("[redacted]");
    expect(records[0]!.fields.user).toBe("a");
  });

  it("honours a sink's own minLevel floor", () => {
    const { records, off } = capture("test-floor", "error");
    logger.info("noise");
    logger.warn("warn");
    logger.error("boom");
    off();
    expect(records.map((r) => r.level)).toEqual(["error"]);
  });

  it("isolates a throwing sink so logging never breaks the caller", () => {
    const good: LogRecord[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    const offBad = registerSink({
      name: "test-bad",
      write: () => {
        throw new Error("sink exploded");
      },
    });
    const offGood = registerSink({ name: "test-good", write: (r) => good.push(r) });
    expect(() => logger.error("x")).not.toThrow();
    offBad();
    offGood();
    expect(good).toHaveLength(1);
  });
});
