import { ORPCError } from "@orpc/server";

export const MIB = 1024 * 1024;

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function maxBase64Length(maxBytes: number): number {
  return Math.ceil(maxBytes / 3) * 4;
}

export function decodeBase64Upload(input: string, maxBytes: number, maxMessage: string): Buffer {
  if (input.length > maxBase64Length(maxBytes)) {
    throw new ORPCError("PAYLOAD_TOO_LARGE", { message: maxMessage });
  }
  if (!BASE64_RE.test(input)) {
    throw new ORPCError("VALIDATION_FAILED", { message: "Datei konnte nicht gelesen werden." });
  }
  const body = Buffer.from(input, "base64");
  if (body.byteLength === 0) {
    throw new ORPCError("VALIDATION_FAILED", { message: "Leere Datei." });
  }
  if (body.byteLength > maxBytes) {
    throw new ORPCError("PAYLOAD_TOO_LARGE", { message: maxMessage });
  }
  return body;
}

export function extensionForMimeType(mimeType: string): string | null {
  switch (mimeType.toLowerCase()) {
    case "application/pdf":
      return "pdf";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return null;
  }
}
