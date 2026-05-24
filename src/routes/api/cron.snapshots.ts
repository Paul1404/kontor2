import { createFileRoute } from "@tanstack/react-router";
import { verifySignature } from "~/server/crypto/hmac";
import { env } from "~/server/env";
import { rateLimit } from "~/server/redis/client";
import { runNightlySnapshot } from "~/server/snapshots/scheduler";

/**
 * External trigger for the nightly snapshot run. Use this when the
 * in-process scheduler is disabled (e.g. behind a Railway Cron service)
 * or when you want to force an off-schedule run.
 *
 * The body is unused; we sign over the empty string so the request still
 * has integrity (and the timestamp guards against replay).
 */
async function handle({ request }: { request: Request }): Promise<Response> {
  const limit = await rateLimit({
    key: `cron-snapshots:${request.headers.get("x-forwarded-for") ?? "ip"}`,
    limit: 6,
    windowSeconds: 3600,
  });
  if (!limit.allowed) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }

  const raw = await request.text();
  const verify = verifySignature({
    secret: env().svumsPushSecret,
    timestampHeader: request.headers.get("x-svums-timestamp"),
    signatureHeader: request.headers.get("x-svums-signature"),
    rawBody: raw,
  });
  if (!verify.ok) {
    return new Response(JSON.stringify({ error: verify.reason }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const result = await runNightlySnapshot({
      actorEmail: "system:cron",
      notes: "Externally triggered cron run",
      trigger: "nightly",
    });
    return Response.json({
      ok: true,
      acquiredLock: result.acquiredLock,
      runId: result.runId,
      memberCount: result.memberCount,
      skippedCount: result.skippedCount,
      bytesTotal: result.bytesTotal,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "internal", message: (err as Error).message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/cron/snapshots")({
  server: { handlers: { POST: handle } },
});
