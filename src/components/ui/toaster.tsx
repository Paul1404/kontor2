import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "~/lib/cn";

type ToastKind = "success" | "error" | "info";

type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
  description?: string;
  durationMs: number;
};

const TOAST_EVENT = "kontor2:toast";
const DEFAULT_DURATION = 4_000;

type ToastDetail = Omit<Toast, "id" | "kind"> & { kind: ToastKind };

function emit(
  kind: ToastKind,
  message: string,
  opts?: { description?: string; durationMs?: number },
) {
  if (typeof window === "undefined") return;
  const detail: ToastDetail = {
    kind,
    message,
    description: opts?.description,
    durationMs: opts?.durationMs ?? DEFAULT_DURATION,
  };
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail }));
}

export const toast = {
  success(message: string, opts?: { description?: string; durationMs?: number }) {
    emit("success", message, opts);
  },
  error(message: string, opts?: { description?: string; durationMs?: number }) {
    emit("error", message, { ...opts, durationMs: opts?.durationMs ?? 6_000 });
  },
  info(message: string, opts?: { description?: string; durationMs?: number }) {
    emit("info", message, opts);
  },
};

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const next: Toast = {
        id,
        kind: detail.kind,
        message: detail.message,
        description: detail.description,
        durationMs: detail.durationMs,
      };
      setToasts((prev) => [...prev, next]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, next.durationMs);
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          toast={t}
          onDismiss={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
        />
      ))}
    </div>
  );
}

function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = t.kind === "success" ? CheckCircle2 : t.kind === "error" ? XCircle : Info;
  const tone =
    t.kind === "success"
      ? "border-success/40 bg-card text-foreground"
      : t.kind === "error"
        ? "border-destructive/40 bg-card text-foreground"
        : "border-border bg-card text-foreground";
  const iconTone =
    t.kind === "success"
      ? "text-success"
      : t.kind === "error"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div
      className={cn(
        "pointer-events-auto motion-slide-in-right flex items-start gap-3 rounded-lg border p-3 shadow-card transition-all",
        tone,
      )}
      role="status"
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconTone)} aria-hidden />
      <div className="flex-1 text-sm">
        <div className="font-medium leading-tight">{t.message}</div>
        {t.description ? (
          <div className="mt-0.5 text-xs text-muted-foreground">{t.description}</div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Schließen"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
