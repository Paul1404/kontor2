export function triggerDownload(
  filename: string,
  content: string,
  mimeType = "application/octet-stream",
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Decode a base64 string into a Blob and trigger a download. Used for
 * server-rendered documents that travel as base64 across the oRPC JSON
 * boundary.
 *
 * Prefer `triggerDocumentDownload` where the server hands back a
 * `{ filename, base64 }` object. Two adjacent string parameters are easy to
 * swap, and swapping them decodes the filename as base64, which fails with the
 * opaque "The string contains invalid characters" instead of anything that
 * points at the mistake.
 */
export function triggerDownloadBase64(
  filename: string,
  base64: string,
  mimeType = "application/octet-stream",
) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Download a document the server returned as `{ filename, base64 }`. Taking the
 * object rather than two strings makes the argument order impossible to get
 * wrong.
 */
export function triggerDocumentDownload(
  doc: { filename: string; base64: string },
  mimeType = "application/pdf",
) {
  triggerDownloadBase64(doc.filename, doc.base64, mimeType);
}
