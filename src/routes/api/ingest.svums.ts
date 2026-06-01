import { createFileRoute } from "@tanstack/react-router";
import { verifySignature } from "~/server/crypto/hmac";
import { db } from "~/server/db/client";
import { env } from "~/server/env";
import { runIngest } from "~/server/importer/ingest-pipeline";
import { acquireNonce, rateLimit } from "~/server/redis/client";

// Mirror the 50 MB cap the interactive SQL-dump import enforces, so a
// compromised or buggy SVUMS sender can't exhaust memory with an unbounded
// (but correctly signed) body.
const MAX_BYTES = 50 * 1024 * 1024;

function tooLarge(): Response {
  return new Response(JSON.stringify({ error: "payload_too_large" }), {
    status: 413,
    headers: { "content-type": "application/json" },
  });
}

async function handle({ request }: { request: Request }): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
    return tooLarge();
  }
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
  // Defend against a missing/dishonest Content-Length: re-check the actual
  // body size before doing any work with it.
  if (raw.length > MAX_BYTES) {
    return tooLarge();
  }
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
    inter?: Array<Record<string, unknown>>;
    interes?: Array<Record<string, unknown>>;
    mgsolln?: Array<Record<string, unknown>>;
    mgartdat?: Array<Record<string, unknown>>;
    sportarten?: Array<Record<string, unknown>>;
    fachverbaende?: Array<Record<string, unknown>>;
    lastprot?: Array<Record<string, unknown>>;
    lastproth?: Array<Record<string, unknown>>;
    lastprots?: Array<Record<string, unknown>>;
    lastprotsh?: Array<Record<string, unknown>>;
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
    inter: payload.inter as never,
    interes: payload.interes as never,
    mgsolln: payload.mgsolln as never,
    mgartdat: payload.mgartdat as never,
    sportarten: payload.sportarten as never,
    fachverbaende: payload.fachverbaende as never,
    lastprot: payload.lastprot as never,
    lastproth: payload.lastproth as never,
    lastprots: payload.lastprots as never,
    lastprotsh: payload.lastprotsh as never,
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
    sollStellungenImported: result.sollStellungenImported,
    feeTypeHistoryImported: result.feeTypeHistoryImported,
    sportTypesImported: result.sportTypesImported,
    federationsImported: result.federationsImported,
    legacySepaRunsImported: result.legacySepaRunsImported,
    legacySepaItemsImported: result.legacySepaItemsImported,
    errors: result.errors,
  });
}

export const Route = createFileRoute("/api/ingest/svums")({
  server: { handlers: { POST: handle } },
});
