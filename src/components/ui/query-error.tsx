import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "~/components/ui/button";

/**
 * Compact inline error state for a failed `useQuery` on a data page. Use
 * this in place of a silent empty/loading state so a backend failure is
 * distinguishable from "no data" and the user can retry without reloading.
 * For full-page route errors use `ErrorPanel` instead.
 */
export function QueryError({
  onRetry,
  title = "Konnte nicht geladen werden",
  description = "Beim Laden der Daten ist ein Fehler aufgetreten.",
  error,
}: {
  onRetry?: () => void;
  title?: string;
  description?: string;
  error?: unknown;
}) {
  const message = error instanceof Error ? error.message : null;
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-8 text-center shadow-soft">
      <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-4" /> Erneut versuchen
        </Button>
      ) : null}
      {message ? <p className="max-w-md text-[11px] text-muted-foreground/70">{message}</p> : null}
    </div>
  );
}

/**
 * Table-body variant: a single full-width row carrying the same error state,
 * for tables that otherwise render an empty `<tbody>` on failure.
 */
export function QueryErrorRow({ colSpan, onRetry }: { colSpan: number; onRetry?: () => void }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <AlertTriangle className="size-6 text-destructive" />
          <p className="text-sm">Daten konnten nicht geladen werden.</p>
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="size-4" /> Erneut versuchen
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
