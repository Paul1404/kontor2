import { statfsSync } from "node:fs";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { sql } from "~/server/db/client";
import { type DailyGateStore, runPersistedDailyGate } from "~/server/lfio/daily-gate";
import { logger } from "~/server/lib/logger";
import { redis } from "~/server/redis/client";
import { bucket, s3Client } from "~/server/s3/client";

const LFIO_INGEST_URL = "https://lfio.pdcd.net/api/ingest";
const DEFAULT_INTERVAL_MS = 60_000;
const POST_TIMEOUT_MS = 10_000;
const COLLECTOR_TIMEOUT_MS = 15_000;
const DEGRADED_RUNTIME_MS = 1_000;
const DEGRADED_DB_CONN_PCT = 80;
const DEGRADED_DB_REPLICATION_LAG_MS = 30_000;
const DEGRADED_REDIS_MEMORY_PCT = 85;
const DEGRADED_REDIS_HIT_RATE_PCT = 80;

type LfioStatus = "up" | "down" | "degraded" | "unknown";
type LfioUnit = "bytes" | "ms" | "%" | "count" | "ops/s";
type LfioMetric = number | { value: number; unit?: LfioUnit; label?: string; group?: string };

type LfioPayload = {
  assetKey: string;
  name?: string;
  status: LfioStatus;
  latencyMs?: number;
  message?: string;
  metrics?: Record<string, LfioMetric>;
  metadata?: Record<string, unknown>;
};

type HttpSample = {
  at: number;
  status: number;
  latencyMs: number;
};

let timer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;
let runtimeOk = false;
let consecutivePostFailures = 0;
const httpSamples: HttpSample[] = [];
let activeRequests = 0;
let bucketInventory: BucketInventory | null = null;
let bucketInventoryRefresh: Promise<void> | null = null;

type BucketInventory = {
  objectCount: number;
  totalSizeBytes: number;
  truncated: boolean;
};

function intervalMs(): number {
  const raw = Number(process.env.LFIO_REPORT_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_MS;
}

function nowMs(): number {
  return Date.now();
}

function pruneHttpSamples(now = nowMs()): void {
  const cutoff = now - 60_000;
  while (httpSamples[0] && httpSamples[0].at < cutoff) httpSamples.shift();
}

export function recordHttpRequest(input: {
  status: number;
  latencyMs: number;
  activeRequests?: number;
}): void {
  httpSamples.push({ at: nowMs(), status: input.status, latencyMs: input.latencyMs });
  activeRequests = input.activeRequests ?? activeRequests;
  pruneHttpSamples();
}

function installHttpMetricsBridge(): void {
  globalThis.__kontor2RecordHttpRequest = recordHttpRequest;
}

async function withTimeout<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${name} timed out after ${COLLECTOR_TIMEOUT_MS}ms`)),
      COLLECTOR_TIMEOUT_MS,
    );
    timeout.unref?.();
    fn().then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    );
  });
}

function metric(value: number, unit: LfioUnit, group?: string, label?: string): LfioMetric {
  return { value, unit, group, label };
}

async function safeCollect(
  assetKey: string,
  name: string,
  collect: () => Promise<LfioPayload>,
): Promise<LfioPayload> {
  try {
    return await withTimeout(assetKey, collect);
  } catch (err) {
    return {
      assetKey,
      name,
      status: "down",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkRuntime(): Promise<boolean> {
  if (runtimeOk) return true;
  try {
    const { Document, Page, Text, renderToBuffer } = await import("@react-pdf/renderer");
    const { createElement: h } = await import("react");
    const doc = h(Document, null, h(Page, null, h(Text, null, "ok")));
    // biome-ignore lint/suspicious/noExplicitAny: react-pdf's element type is internal.
    const buf = await renderToBuffer(doc as any);
    runtimeOk = buf.length > 0;
    return runtimeOk;
  } catch {
    return false;
  }
}

async function collectApi(): Promise<LfioPayload> {
  const started = performance.now();
  const ok = await checkRuntime();
  const runtimeLatencyMs = Math.round(performance.now() - started);
  pruneHttpSamples();

  const requests = httpSamples.length;
  const errors = httpSamples.filter((s) => s.status >= 500).length;
  const sorted = httpSamples.map((s) => s.latencyMs).sort((a, b) => a - b);
  const p95LatencyMs = sorted.length > 0 ? (sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0) : 0;
  const errorRatePct = requests > 0 ? (errors / requests) * 100 : 0;
  const activeUsers = await activeUserCount();
  const slow = ok && (runtimeLatencyMs > DEGRADED_RUNTIME_MS || p95LatencyMs > 2_000);

  return {
    assetKey: "api",
    name: "Kontor2 API",
    status: ok ? (slow ? "degraded" : "up") : "down",
    latencyMs: runtimeLatencyMs,
    message: ok ? (slow ? "API healthy but slow" : "API healthy") : "Runtime check failed",
    metrics: {
      requestsPerMin: metric(requests, "count", "HTTP", "Requests/min"),
      errorRatePct: metric(errorRatePct, "%", "HTTP", "Error rate"),
      p95LatencyMs: metric(p95LatencyMs, "ms", "HTTP", "p95 latency"),
      activeUsers: metric(activeUsers, "count", "HTTP", "Active users"),
      openConnections: metric(activeRequests, "count", "HTTP", "Open requests"),
    },
    metadata: {
      nodeEnv: process.env.NODE_ENV ?? "development",
      uptimeSeconds: Math.round(process.uptime()),
      gitCommit: process.env.RAILWAY_GIT_COMMIT_SHA,
    },
  };
}

async function activeUserCount(): Promise<number> {
  try {
    const rows =
      await sql()`select count(distinct user_id)::int as count from sessions where expires_at > now()`;
    return Number((rows as unknown as Array<{ count: number }>)[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

async function collectDb(): Promise<LfioPayload> {
  const started = performance.now();
  const rows = await sql()`
    with settings as (
      select
        current_setting('max_connections')::int as max_connections,
        current_setting('server_version') as server_version,
        pg_is_in_recovery() as is_replica,
        pg_database_size(current_database())::bigint as db_size_bytes
    ),
    activity as (
      select count(*)::int as active_connections
      from pg_stat_activity
      where datname = current_database()
    ),
    dbstats as (
      select
        xact_commit,
        xact_rollback,
        blks_hit,
        blks_read,
        deadlocks
      from pg_stat_database
      where datname = current_database()
    ),
    slow as (
      select count(*)::int as slow_queries
      from pg_stat_activity
      where datname = current_database()
        and state = 'active'
        and now() - query_start > interval '5 seconds'
    ),
    lag as (
      select case
        when pg_is_in_recovery() then extract(epoch from now() - pg_last_xact_replay_timestamp()) * 1000
        else 0
      end as replication_lag_ms
    )
    select
      settings.max_connections as "connectionsMax",
      settings.server_version as "serverVersion",
      settings.is_replica as "isReplica",
      settings.db_size_bytes as "dbSizeBytes",
      activity.active_connections as "connectionsActive",
      dbstats.blks_hit as "blocksHit",
      dbstats.blks_read as "blocksRead",
      dbstats.deadlocks as "deadlocks",
      slow.slow_queries as "slowQueries",
      coalesce(lag.replication_lag_ms, 0) as "replicationLagMs"
    from settings, activity, dbstats, slow, lag
  `;
  const row = (rows as unknown as Array<Record<string, unknown>>)[0] ?? {};
  const connectionsActive = Number(row.connectionsActive ?? 0);
  const connectionsMax = Number(row.connectionsMax ?? 0);
  const dbSizeBytes = Number(row.dbSizeBytes ?? 0);
  const blocksHit = Number(row.blocksHit ?? 0);
  const blocksRead = Number(row.blocksRead ?? 0);
  const slowQueries = Number(row.slowQueries ?? 0);
  const replicationLagMs = Math.round(Number(row.replicationLagMs ?? 0));
  const deadlocks = Number(row.deadlocks ?? 0);
  const cacheHitRatioPct =
    blocksHit + blocksRead > 0 ? (blocksHit / (blocksHit + blocksRead)) * 100 : 100;
  const connectionPct = connectionsMax > 0 ? (connectionsActive / connectionsMax) * 100 : 0;
  const degraded =
    connectionPct >= DEGRADED_DB_CONN_PCT ||
    replicationLagMs >= DEGRADED_DB_REPLICATION_LAG_MS ||
    slowQueries > 0;

  return {
    assetKey: "db",
    name: "Postgres",
    status: degraded ? "degraded" : "up",
    latencyMs: Math.round(performance.now() - started),
    message: degraded ? "Database healthy with pressure signals" : "Database healthy",
    metrics: {
      connectionsActive: metric(connectionsActive, "count", "Database"),
      connectionsMax: metric(connectionsMax, "count", "Database"),
      dbSizeBytes: metric(dbSizeBytes, "bytes", "Database"),
      slowQueries: metric(slowQueries, "count", "Database"),
      cacheHitRatioPct: metric(cacheHitRatioPct, "%", "Database"),
      replicationLagMs: metric(replicationLagMs, "ms", "Database"),
      deadlocks: metric(deadlocks, "count", "Database"),
    },
    metadata: {
      engine: `postgres ${row.serverVersion ?? "unknown"}`,
      role: row.isReplica ? "replica" : "primary",
    },
  };
}

function parseRedisInfo(raw: string): Record<string, string> {
  const info: Record<string, string> = {};
  for (const line of raw.split("\r\n")) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    info[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return info;
}

function numberInfo(info: Record<string, string>, key: string): number {
  return Number(info[key] ?? 0);
}

async function collectRedis(): Promise<LfioPayload> {
  const started = performance.now();
  const raw = await redis().info();
  const info = parseRedisInfo(raw);
  const usedMemoryBytes = numberInfo(info, "used_memory");
  const maxMemoryBytes = numberInfo(info, "maxmemory");
  const keyspaceHits = numberInfo(info, "keyspace_hits");
  const keyspaceMisses = numberInfo(info, "keyspace_misses");
  const hitRatePct =
    keyspaceHits + keyspaceMisses > 0
      ? (keyspaceHits / (keyspaceHits + keyspaceMisses)) * 100
      : 100;
  const memoryPct = maxMemoryBytes > 0 ? (usedMemoryBytes / maxMemoryBytes) * 100 : 0;
  const degraded =
    (maxMemoryBytes > 0 && memoryPct >= DEGRADED_REDIS_MEMORY_PCT) ||
    hitRatePct < DEGRADED_REDIS_HIT_RATE_PCT;
  const keys = Object.entries(info)
    .filter(([key]) => /^db\d+$/.test(key))
    .reduce((sum, [, value]) => sum + Number(value.match(/keys=(\d+)/)?.[1] ?? 0), 0);

  return {
    assetKey: "redis",
    name: "Redis",
    status: degraded ? "degraded" : "up",
    latencyMs: Math.round(performance.now() - started),
    message: degraded ? "Redis healthy with pressure signals" : "Redis healthy",
    metrics: {
      usedMemoryBytes: metric(usedMemoryBytes, "bytes", "Redis"),
      maxMemoryBytes: metric(maxMemoryBytes, "bytes", "Redis"),
      hitRatePct: metric(hitRatePct, "%", "Redis"),
      connectedClients: metric(numberInfo(info, "connected_clients"), "count", "Redis"),
      keys: metric(keys, "count", "Redis"),
      evictedKeys: metric(numberInfo(info, "evicted_keys"), "count", "Redis"),
      opsPerSec: metric(numberInfo(info, "instantaneous_ops_per_sec"), "ops/s", "Redis"),
    },
    metadata: {
      version: info.redis_version,
      mode: info.redis_mode,
      role: info.role,
      maxmemoryPolicy: info.maxmemory_policy,
    },
  };
}

async function collectBucketInventory(): Promise<BucketInventory> {
  let objectCount = 0;
  let totalSizeBytes = 0;
  let continuationToken: string | undefined;
  let truncated = false;

  for (let pages = 0; pages < 100; pages += 1) {
    const res = await s3Client().send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      objectCount += 1;
      totalSizeBytes += obj.Size ?? 0;
    }
    if (!res.IsTruncated) break;
    continuationToken = res.NextContinuationToken;
    truncated = true;
    if (!continuationToken) break;
  }

  return { objectCount, totalSizeBytes, truncated };
}

const bucketInventoryStore: DailyGateStore = {
  async reserve(key, ttlSeconds) {
    return (await redis().set(key, "reserved", "EX", ttlSeconds, "NX")) === "OK";
  },
  async get(key) {
    return await redis().get(key);
  },
  async put(key, value, ttlSeconds) {
    await redis().set(key, value, "EX", ttlSeconds);
  },
};

async function refreshBucketInventory(): Promise<void> {
  if (bucketInventoryRefresh) return bucketInventoryRefresh;
  bucketInventoryRefresh = (async () => {
    const result = await runPersistedDailyGate({
      namespace: `kontor2:lfio:s3-inventory:${bucket()}`,
      store: bucketInventoryStore,
      collect: collectBucketInventory,
    });
    if (result.status === "fresh" || result.status === "cached") {
      if (result.value) bucketInventory = result.value;
      return;
    }
    logger.warn("lfio bucket inventory skipped", {
      reason: result.status,
      error: result.error,
    });
  })().finally(() => {
    bucketInventoryRefresh = null;
  });
  return bucketInventoryRefresh;
}

async function collectBucket(): Promise<LfioPayload> {
  const started = performance.now();
  await s3Client().send(new HeadBucketCommand({ Bucket: bucket() }));
  // Inventory is deliberately detached from the one-minute reachability path.
  // The persistent daily gate guarantees at most one full listing per UTC day
  // across replicas and fails closed if Redis is unavailable.
  void refreshBucketInventory();
  const inventory = bucketInventory;
  return {
    assetKey: "bucket",
    name: "Object Storage",
    status: inventory?.truncated ? "degraded" : "up",
    latencyMs: Math.round(performance.now() - started),
    message: inventory?.truncated ? "Bucket listing capped at 100 pages" : "Bucket reachable",
    metrics: inventory
      ? {
          objectCount: metric(inventory.objectCount, "count", "Object storage"),
          totalSizeBytes: metric(inventory.totalSizeBytes, "bytes", "Object storage"),
        }
      : undefined,
    metadata: {
      bucket: bucket(),
      endpoint: process.env.AWS_ENDPOINT_URL,
      region: process.env.AWS_DEFAULT_REGION,
      statsSource: inventory ? "ListObjectsV2" : "HeadBucket",
      inventoryCadence: "daily",
      inventoryAvailable: inventory !== null,
      truncated: inventory?.truncated ?? false,
    },
  };
}

async function collectSystem(): Promise<LfioPayload> {
  const memoryPct = totalmem() > 0 ? ((totalmem() - freemem()) / totalmem()) * 100 : 0;
  const cpuPct = cpus().length > 0 ? Math.min(100, ((loadavg()[0] ?? 0) / cpus().length) * 100) : 0;
  let diskPct = 0;
  try {
    const disk = statfsSync("/");
    const totalBlocks = Number(disk.blocks);
    const freeBlocks = Number(disk.bfree);
    diskPct = totalBlocks > 0 ? ((totalBlocks - freeBlocks) / totalBlocks) * 100 : 0;
  } catch {
    diskPct = 0;
  }
  const degraded = cpuPct >= 90 || memoryPct >= 90 || diskPct >= 90;

  return {
    assetKey: "system",
    name: "Runtime System",
    status: degraded ? "degraded" : "up",
    message: degraded ? "System resource usage is high" : "System resources OK",
    metrics: {
      cpuPct: metric(cpuPct, "%", "System"),
      memoryPct: metric(memoryPct, "%", "System"),
      diskPct: metric(diskPct, "%", "System"),
    },
    metadata: {
      platform: process.platform,
      arch: process.arch,
      cpus: cpus().length,
    },
  };
}

async function collectAll(): Promise<LfioPayload[]> {
  const collectors: Array<Promise<LfioPayload>> = [
    safeCollect("api", "Kontor2 API", collectApi),
    safeCollect("db", "Postgres", collectDb),
  ];
  if (process.env.REDIS_URL) collectors.push(safeCollect("redis", "Redis", collectRedis));
  if (process.env.AWS_ENDPOINT_URL && process.env.AWS_S3_BUCKET_NAME) {
    collectors.push(safeCollect("bucket", "Object Storage", collectBucket));
  }
  collectors.push(safeCollect("system", "Runtime System", collectSystem));
  return await Promise.all(collectors);
}

async function postToLfio(payload: LfioPayload, token: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const res = await fetch(LFIO_INGEST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`LFIO ingest returned HTTP ${res.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function reportOnce(): Promise<void> {
  const token = process.env.LFIO_INGEST_TOKEN;
  if (!token) return;
  if (inFlight) return;

  inFlight = true;
  try {
    const payloads = await collectAll();
    const results = await Promise.allSettled(payloads.map((payload) => postToLfio(payload, token)));
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      throw new Error(`${failed.length}/${payloads.length} LFIO posts failed`);
    }
    if (consecutivePostFailures > 0) {
      logger.info("lfio telemetry recovered", { failures: consecutivePostFailures });
    }
    consecutivePostFailures = 0;
  } catch (err) {
    consecutivePostFailures += 1;
    logger.warn("lfio telemetry report failed", {
      failures: consecutivePostFailures,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlight = false;
  }
}

export function startLfioReporter(): void {
  installHttpMetricsBridge();
  if (timer) return;
  if (!process.env.LFIO_INGEST_TOKEN) {
    logger.info("lfio reporter disabled", { reason: "LFIO_INGEST_TOKEN not set" });
    return;
  }

  void reportOnce();
  timer = setInterval(() => void reportOnce(), intervalMs());
  timer.unref?.();
  logger.info("lfio reporter started", { intervalMs: intervalMs() });
}

export function stopLfioReporter(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}
