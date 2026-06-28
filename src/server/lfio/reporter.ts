import { logger } from "~/server/lib/logger";

const LFIO_INGEST_URL = "https://lfio.pdcd.net/api/ingest";
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEGRADED_RUNTIME_MS = 1_000;

type LfioStatus = "up" | "down" | "degraded" | "unknown";

type LfioPayload = {
  assetKey: string;
  name?: string;
  status: LfioStatus;
  latencyMs?: number;
  message?: string;
  metadata?: Record<string, unknown>;
};

let timer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;
let runtimeOk = false;
let consecutivePostFailures = 0;

function intervalMs(): number {
  const raw = Number(process.env.LFIO_REPORT_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_MS;
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

async function buildOverallHealth(): Promise<LfioPayload> {
  const started = performance.now();
  const ok = await checkRuntime();
  const latencyMs = Math.round(performance.now() - started);
  const slow = ok && latencyMs > DEGRADED_RUNTIME_MS;
  return {
    assetKey: "app",
    name: "Kontor2",
    status: ok ? (slow ? "degraded" : "up") : "down",
    latencyMs,
    message: ok
      ? slow
        ? `Runtime check slow (${latencyMs}ms)`
        : "Runtime check OK"
      : "Runtime check failed",
    metadata: {
      nodeEnv: process.env.NODE_ENV ?? "development",
      uptimeSeconds: Math.round(process.uptime()),
      consecutivePostFailures,
      railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME,
      railwayService: process.env.RAILWAY_SERVICE_NAME,
      gitCommit: process.env.RAILWAY_GIT_COMMIT_SHA,
    },
  };
}

async function postToLfio(payload: LfioPayload, token: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
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
    if (!res.ok) {
      throw new Error(`LFIO ingest returned HTTP ${res.status}`);
    }
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
    const payload = await buildOverallHealth();
    await postToLfio(payload, token);
    if (consecutivePostFailures > 0) {
      logger.info("lfio health report recovered", { failures: consecutivePostFailures });
    }
    consecutivePostFailures = 0;
  } catch (err) {
    consecutivePostFailures += 1;
    logger.warn("lfio health report failed", {
      failures: consecutivePostFailures,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlight = false;
  }
}

export function startLfioReporter(): void {
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
