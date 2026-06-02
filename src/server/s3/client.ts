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
      ResponseContentDisposition: opts.filename
        ? `attachment; filename="${opts.filename.replace(/"/g, "")}"`
        : undefined,
    }),
    { expiresIn: opts.expiresSeconds ?? 300 },
  );
}

export async function deleteObject(key: string): Promise<void> {
  await s3Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
