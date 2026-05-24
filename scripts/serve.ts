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

const port = Number(process.env.PORT ?? 3000);
const CLIENT_DIR = resolve(import.meta.dir, "..", "dist", "client");
const PUBLIC_DIR = resolve(import.meta.dir, "..", "public");

type ServerLike = { fetch: (req: Request) => Promise<Response> };
const handler = server as unknown as ServerLike;

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
    if (!full.startsWith(root + "/") && full !== root) continue;
    try {
      const s = statSync(full);
      if (s.isFile()) {
        const ext = full.includes(".") ? full.split(".").pop() ?? "" : "";
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
    return new Response(file.stream(), {
      headers: {
        "content-type": hit.mime,
        "cache-control": "public, max-age=86400, immutable",
      },
    });
  }
  return handler.fetch(request);
}

const s = Bun.serve({ port, fetch: handle });
console.log(`[svuwv] listening on ${s.url}`);
