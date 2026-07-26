import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";

const MAX_BODY_BYTES = 1024;

function tooLarge(): Response {
  return new Response(JSON.stringify({ error: "payload_too_large" }), {
    status: 413,
    headers: { "content-type": "application/json" },
  });
}

/**
 * External trigger for the nightly snapshot run. Use this when the
 * in-process scheduler is disabled (e.g. behind a Railway Cron service)
 * or when you want to force an off-schedule run.
 *
 * The body is unused; we sign over the empty string so the request still
 * has integrity (and the timestamp guards against replay).
 */
const handle = createServerOnlyFn(async ({ request }: { request: Request }): Promise<Response> => {
  // Server imports loaded lazily so the server graph stays out of the client
  // bundle (see api/rpc.$.ts).
  const [
    { verifySignature },
    { env },
    { clientIp },
    { logger },
    { acquireNonce, rateLimit },
    { runNightlySnapshot },
    { snapshotCronResponse },
  ] = await Promise.all([
    import("~/server/crypto/hmac"),
    import("~/server/env"),
    import("~/server/lib/client-ip"),
    import("~/server/lib/logger"),
    import("~/server/redis/client"),
    import("~/server/snapshots/scheduler"),
    import("~/server/snapshots/cron-response"),
  ]);
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return tooLarge();
  }
  const limit = await rateLimit({
    key: `cron-snapshots:${clientIp(request.headers)}`,
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
  if (raw.length > MAX_BODY_BYTES) {
    return tooLarge();
  }
  const verify = verifySignature({
    secret: env().snapshotCronSecret,
    timestampHeader: request.headers.get("x-kontor-timestamp"),
    signatureHeader: request.headers.get("x-kontor-signature"),
    rawBody: raw,
  });
  if (!verify.ok) {
    return new Response(JSON.stringify({ error: verify.reason }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const signature = request.headers.get("x-kontor-signature")!;
  if (!(await acquireNonce(`snapshot-cron:${signature}`, 600))) {
    return new Response(JSON.stringify({ error: "replay" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const result = await runNightlySnapshot({
      actorEmail: "system:cron",
      notes: "Externally triggered cron run",
      trigger: "nightly",
    });
    if (result.failures.length > 0) {
      logger.error("cron.snapshots.incomplete", {
        failedTenants: result.failures.map((failure) => failure.tenant),
        successfulTenants: result.tenants.map((tenant) => tenant.tenant),
      });
    }
    return snapshotCronResponse(result);
  } catch (err) {
    // Log the detail server-side; never echo the raw exception text back to
    // the caller.
    logger.error("cron.snapshots.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});

export const Route = createFileRoute("/api/cron/snapshots")({
  server: { handlers: { POST: handle } },
});
