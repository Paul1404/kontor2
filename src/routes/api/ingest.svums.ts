import { createFileRoute } from "@tanstack/react-router";
import { db } from "~/server/db/client";
import { env } from "~/server/env";
import { verifySignature } from "~/server/crypto/hmac";
import { runIngest } from "~/server/importer/ingest-pipeline";
import { acquireNonce, rateLimit } from "~/server/redis/client";

async function handle({ request }: { request: Request }): Promise<Response> {
  const limit = await rateLimit({
    key: `ingest-svums:${request.headers.get("x-forwarded-for") ?? "ip"}`,
    limit: 30,
    windowSeconds: 60,
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
  const sig = request.headers.get("x-svums-signature")!;
  if (!(await acquireNonce(sig, 600))) {
    return new Response(JSON.stringify({ error: "replay" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });
  }

  let payload: {
    batch?: { svumsBatchId?: string; at?: string };
    members?: Array<Record<string, unknown>>;
    feeTypes?: Array<Record<string, unknown>>;
    contracts?: Array<Record<string, unknown>>;
    sepaMandates?: Array<Record<string, unknown>>;
    relationships?: Array<Record<string, unknown>>;
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return new Response(JSON.stringify({ error: "bad_json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const result = await runIngest(db(), {
    source: "svums_push",
    filename: payload.batch?.svumsBatchId ?? null,
    fileSizeBytes: raw.length,
    members: payload.members as never,
    feeTypes: payload.feeTypes as never,
    contracts: payload.contracts as never,
    sepa: payload.sepaMandates as never,
    relationships: payload.relationships as never,
    requestId: request.headers.get("x-request-id"),
  });

  return Response.json({
    ok: true,
    batchId: result.batchId,
    accepted: result.membersWritten,
    created: result.membersCreated,
    updated: result.membersUpdated,
    feeTypesWritten: result.feeTypesWritten,
    contractsWritten: result.contractsWritten,
    sepaWritten: result.sepaWritten,
    relationshipsWritten: result.relationshipsWritten,
    errors: result.errors,
  });
}

export const Route = createFileRoute("/api/ingest/svums")({
  server: { handlers: { POST: handle } },
});
