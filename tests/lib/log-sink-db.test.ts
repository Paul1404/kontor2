import { afterEach, describe, expect, it } from "vitest";
import { __test, logSinkConfig } from "~/server/lib/log-sink-db";
import type { LogRecord } from "~/server/lib/logger";

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

describe("log sink tenant routing", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  function record(fields: LogRecord["fields"] = {}): LogRecord {
    return {
      time: new Date("2026-06-22T00:00:00.000Z"),
      level: "info",
      message: "test",
      fields,
    };
  }

  function configurePrimaryTenant(): void {
    process.env.DATABASE_URL = "postgres://primary.example.invalid/svu";
    process.env.PRIMARY_TENANT_KEY = "svu";
    delete process.env.TENANTS_JSON;
  }

  it("resolves a primary tenant record to the primary tenant", () => {
    configurePrimaryTenant();

    expect(__test.tenantForLogRecord(record({ tenant: "svu" })).key).toBe("svu");
  });

  it("falls back to primary when a record has no tenant field", () => {
    configurePrimaryTenant();

    expect(__test.tenantForLogRecord(record()).key).toBe("svu");
  });

  it("falls back to primary for unknown tenant keys", () => {
    configurePrimaryTenant();

    expect(__test.tenantForLogRecord(record({ tenant: "missing" })).key).toBe("svu");
  });

  it("ignores non-string or empty tenant values", () => {
    expect(__test.tenantKeyForRecord(record({ tenant: 42 }))).toBeNull();
    expect(__test.tenantKeyForRecord(record({ tenant: "" }))).toBeNull();
    expect(__test.tenantKeyForRecord(record({ tenant: "   " }))).toBeNull();
  });

  it("resolves known non-primary tenants from TENANTS_JSON", () => {
    configurePrimaryTenant();
    process.env.TENANTS_JSON = JSON.stringify([
      { key: "verein2", databaseUrl: "postgres://tenant.example.invalid/verein2" },
    ]);

    expect(__test.tenantForLogRecord(record({ tenant: "verein2" })).key).toBe("verein2");
  });
});
