import { AlertTriangle, Loader2, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/cn";
import { useModalFocus } from "~/lib/modal-focus";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Bestätigen",
  cancelLabel = "Abbrechen",
  destructive = false,
  loading = false,
  confirmDisabled = false,
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useModalFocus({
    open,
    containerRef: dialogRef,
    initialFocusRef: cancelRef,
    onEscape: () => {
      if (!loading) onOpenChange(false);
    },
  });

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a click-to-dismiss affordance; keyboard users dismiss via Escape (wired in the effect above) and via the explicit close button.
    <div
      className="motion-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onOpenChange(false);
      }}
    >
      <div
        ref={dialogRef}
        className="motion-zoom-in flex w-full max-w-xl flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-card"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg",
                destructive ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
              )}
            >
              <AlertTriangle className="size-5" />
            </div>
            <div className="flex flex-col gap-0.5">
              <h2 id="confirm-dialog-title" className="text-base font-semibold tracking-tight">
                {title}
              </h2>
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Schließen"
            disabled={loading}
          >
            <X className="size-4" />
          </button>
        </div>
        {children ? (
          <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-sm">
            {children}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Stronger sibling of `ConfirmDialog` for genuinely destructive actions:
 * the confirm button stays disabled until the user types `confirmPhrase`
 * verbatim into the input. Optionally requires the phrase twice (used for
 * the wipe-everything action). Whitespace is trimmed; case-sensitive.
 */
export function TypeToConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Endgültig ausführen",
  cancelLabel = "Abbrechen",
  loading = false,
  confirmPhrase,
  doubleConfirm = false,
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  confirmPhrase: string;
  doubleConfirm?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [typedAgain, setTypedAgain] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus({
    open,
    containerRef: dialogRef,
    initialFocusRef: inputRef,
    onEscape: () => {
      if (!loading) onOpenChange(false);
    },
  });
  useEffect(() => {
    if (!open) return;
    setTyped("");
    setTypedAgain("");
  }, [open]);

  if (!open) return null;

  const firstMatches = typed.trim() === confirmPhrase;
  const secondMatches = !doubleConfirm || typedAgain.trim() === confirmPhrase;
  const canConfirm = firstMatches && secondMatches && !loading;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismissal is mouse-only; keyboard uses Escape.
    <div
      className="motion-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="type-to-confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onOpenChange(false);
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="motion-zoom-in flex w-full max-w-xl flex-col gap-4 rounded-xl border border-destructive/40 bg-card p-6 shadow-elevated"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <AlertTriangle className="size-5" />
            </div>
            <div className="flex flex-col gap-0.5">
              <h2 id="type-to-confirm-title" className="text-base font-semibold tracking-tight">
                {title}
              </h2>
              {description ? (
                <div className="text-sm text-muted-foreground">{description}</div>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Schließen"
            disabled={loading}
          >
            <X className="size-4" />
          </button>
        </div>
        {children ? (
          <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-sm">
            {children}
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the Input component below, which renders an <input>. */}
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">
              Tippen Sie zur Bestätigung exakt:{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                {confirmPhrase}
              </code>
            </span>
            <Input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              disabled={loading}
              aria-invalid={typed.length > 0 && !firstMatches}
              className={cn(
                "font-mono",
                firstMatches && "border-success focus-visible:border-success",
              )}
            />
          </label>
          {doubleConfirm ? (
            // biome-ignore lint/a11y/noLabelWithoutControl: wraps the Input component below.
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">Zur doppelten Sicherheit erneut tippen:</span>
              <Input
                value={typedAgain}
                onChange={(e) => setTypedAgain(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                disabled={loading || !firstMatches}
                aria-invalid={typedAgain.length > 0 && !secondMatches}
                className={cn(
                  "font-mono",
                  secondMatches &&
                    typedAgain.length > 0 &&
                    "border-success focus-visible:border-success",
                )}
              />
            </label>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={!canConfirm}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
