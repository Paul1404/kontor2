import { type DocumentProps, renderToBuffer } from "@react-pdf/renderer";
import type { ReactElement } from "react";

/**
 * Render a react-pdf document tree to a base64-encoded PDF string so it can
 * cross the oRPC JSON boundary. The UI decodes it back into a Blob for
 * download. This keeps the procedure surface uniform with the existing
 * `{ filename, content }` CSV pattern (CSV is utf-8 text, PDF is base64).
 */
export async function renderPdfBase64(element: ReactElement<DocumentProps>): Promise<{
  base64: string;
  byteSize: number;
}> {
  const buf = await renderToBuffer(element);
  return { base64: buf.toString("base64"), byteSize: buf.byteLength };
}
