import { Info, type LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "~/lib/cn";

type Tone = "info" | "muted" | "warning";

const TONES: Record<Tone, { container: string; icon: string }> = {
  info: {
    container: "border-sky-500/30 bg-sky-500/5",
    icon: "text-sky-600 dark:text-sky-400",
  },
  muted: {
    container: "border-border bg-muted/40",
    icon: "text-muted-foreground",
  },
  warning: {
    container: "border-warning/40 bg-warning/10",
    icon: "text-warning",
  },
};

type InfoBoxProps = {
  title?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
};

export function InfoBox({
  title,
  icon: IconComp = Info,
  tone = "info",
  collapsible = false,
  defaultOpen = true,
  className,
  children,
}: InfoBoxProps) {
  const [open, setOpen] = useState(defaultOpen);
  const t = TONES[tone];

  if (collapsible) {
    return (
      <div className={cn("rounded-lg border", t.container, className)}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium"
          aria-expanded={open}
        >
          <IconComp className={cn("size-4 shrink-0", t.icon)} />
          <span className="flex-1">{title ?? "So funktioniert es"}</span>
          <span className={cn("text-xs", t.icon)}>{open ? "schließen" : "anzeigen"}</span>
        </button>
        {open ? (
          <div className="border-t border-current/10 px-4 py-3 text-sm text-foreground/90">
            {children}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        t.container,
        className,
      )}
    >
      <IconComp className={cn("mt-0.5 size-4 shrink-0", t.icon)} />
      <div className="flex flex-col gap-1 text-foreground/90">
        {title ? <div className="font-medium text-foreground">{title}</div> : null}
        <div className="text-foreground/80">{children}</div>
      </div>
    </div>
  );
}
