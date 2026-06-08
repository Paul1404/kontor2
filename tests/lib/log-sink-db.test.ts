import { afterEach, describe, expect, it } from "vitest";
import { logSinkConfig } from "~/server/lib/log-sink-db";

describe("logSinkConfig", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("is disabled under test so the suite never writes to the database", () => {
    expect(logSinkConfig().enabled).toBe(false);
  });

  it("can be disabled explicitly via LOG_DB_DISABLED outside of test", () => {
    process.env.NODE_ENV = "production";
    process.env.LOG_DB_DISABLED = "1";
    expect(logSinkConfig().enabled).toBe(false);
    process.env.LOG_DB_DISABLED = "0";
    expect(logSinkConfig().enabled).toBe(true);
  });

  it("reads level, retention window and row cap from the environment", () => {
    process.env.LOG_DB_LEVEL = "warn";
    process.env.LOG_DB_RETENTION_DAYS = "30";
    process.env.LOG_DB_MAX_ROWS = "5000";
    const c = logSinkConfig();
    expect(c.level).toBe("warn");
    expect(c.retentionDays).toBe(30);
    expect(c.maxRows).toBe(5000);
  });

  it("falls back to safe defaults on invalid or out-of-range values", () => {
    process.env.LOG_DB_LEVEL = "verbose";
    process.env.LOG_DB_RETENTION_DAYS = "-3";
    process.env.LOG_DB_MAX_ROWS = "abc";
    const c = logSinkConfig();
    expect(c.level).toBe("info");
    expect(c.retentionDays).toBe(14);
    expect(c.maxRows).toBe(100_000);
  });
});
