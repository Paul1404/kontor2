#!/usr/bin/env bun
/**
 * Production runtime entry: imports the Vite-built server handler and serves
 * it on `process.env.PORT`. Static files from `dist/client` are served
 * directly with a 1-day cache; everything else falls through to the SSR
 * handler (which itself serves built JS/CSS asset chunks).
 */
import { statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import server from "../dist/server/server.js";
import { log } from "./log";
import { preflight } from "./preflight";
import { createShutdownHandler } from "./shutdown";

const port = Number(process.env.PORT ?? 3000);
const CLIENT_DIR = resolve(import.meta.dir, "..", "dist", "client");
const PUBLIC_DIR = resolve(import.meta.dir, "..", "public");

type ServerLike = { fetch: (req: Request) => Promise<Response> };
const handler = server as unknown as ServerLike;

// Response headers applied to every response. These are safe defaults that
// don't depend on the request: clickjacking, MIME-sniffing, referrer leakage,
// and feature-policy lockdown. HSTS is harmless over plain HTTP (browsers only
// honour it on HTTPS) and Railway terminates TLS in front of us.
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-dns-prefetch-control": "off",
};

// Content-Security-Policy for HTML documents. `unsafe-inline` is required for
// the SSR hydration/router script TanStack Start injects inline and for inline
// style attributes; `img-src https:` allows member attachments served from
// signed S3 URLs. Override the whole policy with CONTENT_SECURITY_POLICY, or
// set it empty to disable.
const DEFAULT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
].join("; ");

const CSP = process.env.CONTENT_SECURITY_POLICY ?? DEFAULT_CSP;

function withSecurityHeaders(res: Response): Response {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!res.headers.has(key)) res.headers.set(key, value);
  }
  const type = res.headers.get("content-type") ?? "";
  if (CSP && type.includes("text/html") && !res.headers.has("content-security-policy")) {
    res.headers.set("content-security-policy", CSP);
  }
  return res;
}

const MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  webmanifest: "application/manifest+json",
  json: "application/json",
  js: "application/javascript",
  mjs: "application/javascript",
  css: "text/css",
  txt: "text/plain",
};

function tryStaticFile(pathname: string): { path: string; mime: string } | null {
  if (pathname === "/" || pathname.includes("..") || pathname.includes("\0")) return null;
  const safe = normalize(pathname).replace(/^[/\\]+/, "");
  for (const root of [CLIENT_DIR, PUBLIC_DIR]) {
    const full = join(root, safe);
    if (!full.startsWith(`${root}/`) && full !== root) continue;
    try {
      const s = statSync(full);
      if (s.isFile()) {
        const ext = full.includes(".") ? (full.split(".").pop() ?? "") : "";
        return { path: full, mime: MIME[ext] ?? "application/octet-stream" };
      }
    } catch {
      /* not found in this root */
    }
  }
  return null;
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const hit = tryStaticFile(url.pathname);
  if (hit) {
    const file = Bun.file(hit.path);
    return withSecurityHeaders(
      new Response(file.stream(), {
        headers: {
          "content-type": hit.mime,
          "cache-control": "public, max-age=86400, immutable",
        },
      }),
    );
  }
  return withSecurityHeaders(await handler.fetch(request));
}

try {
  await preflight();
} catch (err) {
  log.error("startup aborted", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}

const s = Bun.serve({ port, fetch: handle });
log.info("listening", { url: String(s.url) });

// Graceful shutdown. Railway sends SIGTERM on redeploy; without this the
// container is killed mid-request and DB/Redis connections are reset instead of
// drained. Drain in-flight requests, then release app resources through the
// bridge the server bundle installed on `globalThis` (it can't be imported here
// — see scripts/shutdown.ts), then exit.
const shutdown = createShutdownHandler({
  stopServer: (force) => s.stop(force),
  closeResources: () => globalThis.__svuwvCloseResources?.(),
  log,
  exit: (code) => process.exit(code),
  drainTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 15_000),
});
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// A rejected promise or thrown error with no handler must not vanish silently.
// An uncaught exception leaves the process in an undefined state, so we exit
// non-zero and let Railway restart a clean container. An unhandled rejection is
// usually a stray library promise; log it for visibility but keep serving
// rather than risk a restart loop.
process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection", {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});
process.on("uncaughtException", (err) => {
  log.error("uncaughtException", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

// The snapshot scheduler initialises lazily inside `createContext` (oRPC).
// On a freshly-deployed container with no oRPC traffic between deploy and
// 02:30, the nightly run would silently skip. Fix: make one self-request to
// the oRPC endpoint right after `Bun.serve` accepts connections. The HTTP
// response itself doesn't matter — even a 4xx still runs `createContext`,
// which is what starts the scheduler.
queueMicrotask(() => {
  const url = new URL("/api/rpc/auth/setupStatus", s.url).toString();
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    .then(() => log.info("snapshot scheduler warmed up"))
    .catch((err) =>
      log.warn("scheduler warmup failed", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
});
