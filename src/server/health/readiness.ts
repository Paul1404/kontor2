import Redis from "ioredis";
import postgres from "postgres";
import { controlDbUrl } from "~/server/db/client";
import { env } from "~/server/env";
import { createHealthcheck } from "./check";

// Only the immutable runtime module graph is cached. Dependency reachability
// must be checked again after both success and failure.
let pdfOk = false;
let pdfPending: Promise<boolean> | undefined;
function checkPdf(): Promise<boolean> {
  if (pdfOk) return Promise.resolve(true);
  pdfPending ??= (async () => {
    const { Document, Page, Text, renderToBuffer } = await import("@react-pdf/renderer");
    const { createElement: h } = await import("react");
    const buffer = await renderToBuffer(h(Document, null, h(Page, null, h(Text, null, "ok"))));
    pdfOk = buffer.length > 0;
    return pdfOk;
  })().finally(() => {
    pdfPending = undefined;
  });
  return pdfPending;
}

async function checkDatabase(url: string): Promise<boolean> {
  const connection = postgres(url, {
    max: 1,
    connect_timeout: 3,
    connection: { statement_timeout: 3_000 },
    onnotice: () => {},
  });
  try {
    await connection`select 1`;
    return true;
  } finally {
    await connection.end({ timeout: 1 });
  }
}

async function checkRedis(): Promise<boolean> {
  const client = new Redis(env().REDIS_URL, {
    protocol: 2,
    lazyConnect: true,
    connectTimeout: 3_000,
    commandTimeout: 3_000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  // Public readiness responses deliberately contain no connection details.
  client.on("error", () => {});
  try {
    await client.connect();
    return (await client.ping()) === "PONG";
  } finally {
    client.disconnect();
  }
}

export const checkReadiness = createHealthcheck({
  db: () => checkDatabase(env().DATABASE_URL),
  controlDb: () => checkDatabase(controlDbUrl()),
  redis: checkRedis,
  pdf: checkPdf,
});
