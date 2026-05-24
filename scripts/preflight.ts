/**
 * Startup connectivity check. Opens short-lived connections to Postgres,
 * Redis, and S3 to verify env config and reachability, then closes them.
 * Kept self-contained (no `src/` imports) so it runs in the slim runtime
 * container that ships only `dist/`, `scripts/`, and `node_modules`.
 */
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import Redis from "ioredis";
import postgres from "postgres";

const TIMEOUT_MS = 5_000;

function withTimeout<T>(name: string, p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function checkPostgres(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    await sql`select 1`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function checkRedis(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL not set");
  const r = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
  });
  try {
    await r.connect();
    await r.ping();
  } finally {
    r.disconnect();
  }
}

async function checkS3(): Promise<void> {
  const endpoint = process.env.AWS_ENDPOINT_URL;
  const region = process.env.AWS_DEFAULT_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("AWS_* env vars incomplete");
  }
  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } finally {
    client.destroy();
  }
}

type Result =
  | { name: string; ok: true; ms: number }
  | { name: string; ok: false; ms: number; error: string };

async function run(name: string, fn: () => Promise<void>): Promise<Result> {
  const start = performance.now();
  try {
    await withTimeout(name, fn(), TIMEOUT_MS);
    return { name, ok: true, ms: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      name,
      ok: false,
      ms: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function preflight(): Promise<void> {
  const results = await Promise.all([
    run("postgres", checkPostgres),
    run("redis", checkRedis),
    run("s3", checkS3),
  ]);
  for (const r of results) {
    if (r.ok) console.log(`[svuwv] ${r.name.padEnd(8)} ok (${r.ms}ms)`);
    else console.error(`[svuwv] ${r.name.padEnd(8)} FAIL (${r.ms}ms): ${r.error}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new Error(`preflight failed: ${failed.map((r) => r.name).join(", ")}`);
  }
}
