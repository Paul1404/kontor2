import { toast } from "~/components/ui/toaster";
import { triggerDownload, triggerDownloadBase64 } from "~/lib/download";

/**
 * Run a server-side CSV export and trigger the download, surfacing success
 * and failure as toasts. Centralises the try/catch so individual export
 * buttons can't fail silently.
 */
export async function exportCsvFile(
  run: () => Promise<{ filename: string; content: string }>,
  successMessage = "CSV heruntergeladen",
): Promise<void> {
  try {
    const res = await run();
    triggerDownload(res.filename, res.content, "text/csv;charset=utf-8");
    toast.success(successMessage);
  } catch (err) {
    toast.error("Export fehlgeschlagen", {
      description: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Same as {@link exportCsvFile} but for base64 payloads (e.g. server PDFs). */
export async function exportBase64File(
  run: () => Promise<{ filename: string; base64: string }>,
  mime: string,
  successMessage = "Datei heruntergeladen",
): Promise<void> {
  try {
    const res = await run();
    triggerDownloadBase64(res.filename, res.base64, mime);
    toast.success(successMessage);
  } catch (err) {
    toast.error("Export fehlgeschlagen", {
      description: err instanceof Error ? err.message : String(err),
    });
  }
}
