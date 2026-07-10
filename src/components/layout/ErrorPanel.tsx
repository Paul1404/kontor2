import { Link, useRouter } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button, buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/cn";

export function ErrorPanel({
  title = "Etwas ist schiefgelaufen",
  description = "Beim Laden dieser Seite ist ein Fehler aufgetreten. Bitte erneut versuchen.",
  error,
  reset,
  showHome = true,
}: {
  title?: string;
  description?: string;
  error?: unknown;
  reset?: () => void;
  showHome?: boolean;
}) {
  const router = useRouter();
  const [showDetails, setShowDetails] = useState(false);
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error
          ? safeStringify(error)
          : null;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 text-center shadow-soft sm:p-8">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" />
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {reset ? (
          <Button
            type="button"
            variant="default"
            onClick={() => {
              reset();
              router.invalidate();
            }}
          >
            <RefreshCw className="size-4" /> Erneut versuchen
          </Button>
        ) : (
          <Button type="button" variant="default" onClick={() => router.invalidate()}>
            <RefreshCw className="size-4" /> Erneut laden
          </Button>
        )}
        {showHome ? (
          <Link to="/app" className={cn(buttonVariants({ variant: "outline" }))}>
            <ArrowLeft className="size-4" /> Zur Übersicht
          </Link>
        ) : null}
      </div>
      {message ? (
        <div className="w-full text-left">
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {showDetails ? "Details ausblenden" : "Technische Details"}
          </button>
          {showDetails ? (
            <pre className="mt-2 max-h-48 overflow-auto rounded border border-border bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {message}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function NotFoundPanel({ children }: { children?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 text-center shadow-soft sm:p-8">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <AlertTriangle className="size-6" />
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Seite nicht gefunden</h1>
        <p className="text-sm text-muted-foreground">
          {children ?? "Diese Seite existiert nicht oder wurde verschoben."}
        </p>
      </div>
      <Link to="/app" className={cn(buttonVariants())}>
        <ArrowLeft className="size-4" /> Zur Übersicht
      </Link>
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
