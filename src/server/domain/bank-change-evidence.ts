export const BANK_CHANGE_MAX_BYTES = 10 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".eml": "message/rfc822",
  ".msg": "application/vnd.ms-outlook",
};

export const BANK_CHANGE_ACCEPT = Object.keys(MIME_BY_EXTENSION).join(",");

export function bankChangeEvidenceMime(filename: string, reportedMime: string): string | null {
  const dot = filename.lastIndexOf(".");
  const extension = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  const expected = MIME_BY_EXTENSION[extension];
  if (!expected) return null;

  const reported = reportedMime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (reported === "" || reported === "application/octet-stream") return expected;
  if (reported === expected) return expected;
  // Browsers disagree on Outlook message types. The extension and the magic
  // byte check at apply time remain authoritative.
  if (extension === ".msg" && reported === "application/msoutlook") return expected;
  if (extension === ".eml" && reported === "text/plain") return expected;
  return null;
}

export function isValidBankChangeEvidence(bytes: Uint8Array, mimeType: string): boolean {
  if (bytes.byteLength === 0) return false;
  if (mimeType === "application/pdf") {
    return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  }
  if (mimeType === "image/png") {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === "image/jpeg") {
    return startsWith(bytes, [0xff, 0xd8, 0xff]);
  }
  if (mimeType === "application/vnd.ms-outlook") {
    return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
  if (mimeType === "message/rfc822") {
    const header = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 64 * 1024));
    const matches = header.match(
      /^(from|to|subject|date|message-id|mime-version|content-type):/gim,
    );
    return (matches?.length ?? 0) >= 2 && /\r?\n\r?\n/.test(header);
  }
  return false;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}
