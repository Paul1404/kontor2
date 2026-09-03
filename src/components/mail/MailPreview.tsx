import { ChevronDown, FileText, Paperclip } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { formatBytes } from "~/lib/format";

export type MailPreviewAttachment = {
  id: string;
  filename: string;
  sizeBytes?: number | null;
  /** Browsers render PDF and images inline; anything else is offered as a link. */
  mimeType?: string | null;
  /**
   * Resolves to a URL the browser can display. Called lazily, because a
   * presigned link should only be minted when someone actually looks.
   */
  resolveUrl: () => Promise<string>;
};

/**
 * Shows a mail the way its recipient will see it: the rendered HTML, a plain
 * text alternative, and every attachment openable in place. Operators send
 * these to real members, so "what exactly am I about to send" has to be
 * answerable without leaving the dialog.
 *
 * The HTML runs in a fully sandboxed iframe with its own restrictive CSP. It is
 * our own rendered markup, but it carries member-supplied names, so it is
 * treated as untrusted: no scripts, no network, images only from data URIs.
 */
export function MailPreview({
  to,
  subject,
  html,
  text,
  attachments = [],
}: {
  to: string | null;
  subject: string;
  html?: string | null;
  text: string;
  attachments?: MailPreviewAttachment[];
}) {
  const [view, setView] = useState<"html" | "text">("html");
  const showHtml = Boolean(html) && view === "html";
  const safeHtml = html
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">${html}`
    : null;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 text-xs">
          <p className="truncate">
            <span className="text-muted-foreground">An:</span> {to ?? "—"}
          </p>
          <p className="mt-0.5 truncate font-medium">{subject}</p>
        </div>
        {html ? (
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              size="sm"
              variant={view === "html" ? "secondary" : "ghost"}
              onClick={() => setView("html")}
            >
              Darstellung
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === "text" ? "secondary" : "ghost"}
              onClick={() => setView("text")}
            >
              Nur Text
            </Button>
          </div>
        ) : null}
      </div>

      {showHtml && safeHtml ? (
        <iframe
          title="Vorschau der E-Mail"
          sandbox=""
          srcDoc={safeHtml}
          className="min-h-[26rem] w-full border-0 bg-white"
        />
      ) : (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-3 font-sans text-xs leading-relaxed">
          {text}
        </pre>
      )}

      {attachments.length > 0 ? (
        <div className="border-t border-border">
          <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">
            {attachments.length} {attachments.length === 1 ? "Anhang" : "Anhänge"}
          </p>
          <div className="flex flex-col gap-1 p-2">
            {attachments.map((attachment) => (
              <AttachmentRow key={attachment.id} attachment={attachment} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const VIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg"]);

function AttachmentRow({ attachment }: { attachment: MailPreviewAttachment }) {
  const viewable = !attachment.mimeType || VIEWABLE.has(attachment.mimeType);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (url || loading) return;
    setLoading(true);
    setError(null);
    try {
      setUrl(await attachment.resolveUrl());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Anhang konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded border border-border">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent"
      >
        <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
        {attachment.sizeBytes ? (
          <span className="shrink-0 text-muted-foreground">
            {formatBytes(attachment.sizeBytes)}
          </span>
        ) : null}
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="border-t border-border p-2">
          {loading ? (
            <p className="text-xs text-muted-foreground">Anhang wird geladen…</p>
          ) : error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : url && viewable ? (
            <iframe
              title={`Vorschau ${attachment.filename}`}
              src={url}
              className="h-96 w-full rounded border border-border bg-white"
            />
          ) : url ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="size-3.5" aria-hidden />
              Dieser Dateityp lässt sich hier nicht anzeigen.{" "}
              <a href={url} target="_blank" rel="noreferrer" className="underline">
                Herunterladen
              </a>
            </p>
          ) : (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="size-3.5" aria-hidden /> Keine Vorschau verfügbar.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
