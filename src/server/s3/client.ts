import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "~/server/env";

let s3: S3Client | undefined;

export function s3Client(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      endpoint: env().AWS_ENDPOINT_URL,
      region: env().AWS_DEFAULT_REGION,
      credentials: {
        accessKeyId: env().AWS_ACCESS_KEY_ID,
        secretAccessKey: env().AWS_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    });
  }
  return s3;
}

export function bucket(): string {
  return env().AWS_S3_BUCKET_NAME;
}

/**
 * Build a safe `Content-Disposition` value for a download. Follows RFC 6266:
 * an ASCII-only `filename` fallback for legacy agents plus a UTF-8
 * percent-encoded `filename*` for the real name (umlauts etc.). Control
 * characters, quotes and path separators are stripped first, so a crafted
 * filename cannot inject extra header parameters or break out of the quoted
 * string.
 */
export function contentDisposition(filename: string): string {
  // Strip control characters (0x00-0x1f, 0x7f) plus the bytes that could break
  // out of the quoted parameter: double quote, backslash and forward slash.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing control chars from a filename is the intent.
  const stripControl = /[\x00-\x1f\x7f"\\/]+/g;
  const cleaned = filename.replace(stripControl, "_").trim() || "download";
  const ascii = cleaned.replace(/[^ -~]+/g, "_");
  const utf8 = encodeURIComponent(cleaned);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export function presignUpload(opts: {
  key: string;
  contentType: string;
  contentLength: number;
  expiresSeconds?: number;
}): Promise<string> {
  return getSignedUrl(
    s3Client(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: opts.key,
      ContentType: opts.contentType,
      ContentLength: opts.contentLength,
    }),
    { expiresIn: opts.expiresSeconds ?? 300 },
  );
}

/**
 * Upload bytes generated on the server (e.g. a rendered PDF) directly. Unlike
 * `presignUpload`, which hands the browser a URL to PUT to, this writes from
 * within the request handler.
 */
export async function putObject(opts: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  await s3Client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
      ContentLength: opts.body.byteLength,
    }),
  );
}

export function presignDownload(opts: {
  key: string;
  filename?: string;
  expiresSeconds?: number;
}): Promise<string> {
  return getSignedUrl(
    s3Client(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: opts.key,
      ResponseContentDisposition: opts.filename ? contentDisposition(opts.filename) : undefined,
    }),
    { expiresIn: opts.expiresSeconds ?? 300 },
  );
}

/** Read an object's bytes back from the bucket (e.g. a stored signature PNG). */
export async function getObject(key: string): Promise<Buffer> {
  const res = await s3Client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error(`empty object: ${key}`);
  return Buffer.from(bytes);
}

export async function deleteObject(key: string): Promise<void> {
  await s3Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
