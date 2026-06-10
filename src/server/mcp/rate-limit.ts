import { createHash } from "node:crypto";
import { rateLimit } from "~/server/redis/client";

/**
 * Per-key throttling for the MCP endpoint (`/api/mcp`).
 *
 * This replaces the better-auth api-key plugin's own rate limit as the gate
 * that actually throttles traffic. The plugin signals "over limit" by making
 * `verifyApiKey` return `valid: false`, which the route can only map to a 401 —
 * telling an AI client to stop and re-authenticate when it should back off and
 * retry. So the plugin's ceiling is raised to effectively unlimited (it still
 * tracks `lastRequest`) and the real limit lives here, where a breach produces
 * a 429 with a `Retry-After` header instead.
 *
 * Backed by the shared Redis limiter, which fails open on a Redis outage.
 */
export const MCP_RATE_LIMIT = 120;
export const MCP_RATE_WINDOW_SECONDS = 60;

export type McpRateLimitDecision = {
  allowed: boolean;
  /** Seconds the client should wait before retrying. 0 when allowed. */
  retryAfterSeconds: number;
  remaining: number;
};

export async function enforceMcpRateLimit(
  rawKey: string,
  opts: { limit?: number; windowSeconds?: number } = {},
): Promise<McpRateLimitDecision> {
  const limit = opts.limit ?? MCP_RATE_LIMIT;
  const windowSeconds = opts.windowSeconds ?? MCP_RATE_WINDOW_SECONDS;
  // Key on a hash of the raw key so the plaintext never lands in Redis, while
  // still being stable per key across requests and replicas.
  const id = createHash("sha256").update(rawKey).digest("hex").slice(0, 32);
  const r = await rateLimit({ key: `mcp:${id}`, limit, windowSeconds });
  const nowSeconds = Math.floor(Date.now() / 1000);
  const retryAfterSeconds = r.allowed ? 0 : Math.max(1, r.resetAt - nowSeconds);
  return { allowed: r.allowed, retryAfterSeconds, remaining: r.remaining };
}
