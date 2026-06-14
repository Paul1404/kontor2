import { ExternalLink, X } from "lucide-react";
import { useEffect } from "react";

/**
 * Vollflächiger Dokument-Viewer: zeigt ein (inline ausgeliefertes) PDF in einem
 * Overlay statt es herunterzuladen. Der Browser rendert das PDF im iframe; über
 * dessen eigene Leiste kann man bei Bedarf speichern/drucken. Escape oder Klick
 * auf den Hintergrund schließt.
 */
export function PdfViewer({
  open,
  onOpenChange,
  url,
  filename,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string | null;
  filename?: string | null;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; Escape handled in the effect and via the close button.
    <div
      className="motion-fade-in fixed inset-0 z-50 flex flex-col bg-black/50 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={filename ?? "Dokument"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-elevated">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <p className="truncate text-sm font-medium">{filename ?? "Dokument"}</p>
          <div className="flex items-center gap-1">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                title="In neuem Tab öffnen"
                aria-label="In neuem Tab öffnen"
              >
                <ExternalLink className="size-4" />
                <span className="hidden sm:inline">Neuer Tab</span>
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Schließen"
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-muted">
          {url ? (
            <iframe src={url} title={filename ?? "Dokument"} className="h-full w-full border-0" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
