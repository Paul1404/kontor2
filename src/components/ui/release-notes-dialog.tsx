import { Sparkles, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useModalFocus } from "~/lib/modal-focus";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  COPYRIGHT,
  RELEASES,
  type Release,
  type ReleaseCategory,
  writeLastSeenVersion,
} from "~/lib/release-notes";

export function ReleaseNotesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalFocus({
    open,
    containerRef: dialogRef,
    initialFocusRef: closeRef,
    onEscape: () => onOpenChange(false),
  });

  // Acknowledging happens on open, not on close — opening is intent enough.
  // Re-runs whenever a fresh release arrives.
  useEffect(() => {
    if (!open) return;
    if (RELEASES[0]) writeLastSeenVersion(RELEASES[0].version);
  }, [open]);

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is click-to-dismiss; Escape is wired separately.
    <div
      className="motion-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Versionshinweise"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="motion-zoom-in flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card text-card-foreground shadow-card"
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <div>
              <h2 className="text-base font-semibold tracking-tight">Versionshinweise</h2>
              <p className="text-xs text-muted-foreground">
                Aktuelle Version:{" "}
                <span className="font-medium text-foreground">{RELEASES[0]?.version}</span>
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Schließen"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-6 overflow-y-auto px-6 py-4 scrollbar-thin">
          {RELEASES.map((release) => (
            <ReleaseSection key={release.version} release={release} />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-3 text-[11px] text-muted-foreground">
          <span>
            Hinweise leben in{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono">src/lib/release-notes.ts</code>
            .
          </span>
          <span className="shrink-0">{COPYRIGHT}</span>
        </div>
      </div>
    </div>
  );
}

function ReleaseSection({ release }: { release: Release }) {
  const grouped = groupByCategory(release);
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
        <div className="flex items-baseline gap-2">
          <span className="rounded-md bg-primary px-2 py-0.5 text-[12px] font-semibold tabular-nums text-primary-foreground">
            {release.version}
          </span>
          {release.title ? <span className="text-sm font-medium">{release.title}</span> : null}
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground">{release.date}</span>
      </header>
      <div className="flex flex-col gap-3">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped[cat];
          if (!items || items.length === 0) return null;
          return (
            <div key={cat} className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {CATEGORY_LABELS[cat]}
              </div>
              <ul className="flex flex-col gap-1.5 pl-3">
                {items.map((change) => (
                  <li
                    key={change.description}
                    className="relative pl-3 text-[13px] leading-relaxed text-foreground/90 before:absolute before:left-0 before:top-[0.55em] before:size-1 before:rounded-full before:bg-muted-foreground/50"
                  >
                    {change.description}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function groupByCategory(release: Release): Partial<Record<ReleaseCategory, Release["changes"]>> {
  const out: Partial<Record<ReleaseCategory, Release["changes"]>> = {};
  for (const c of release.changes) {
    const list = out[c.category] ?? [];
    list.push(c);
    out[c.category] = list;
  }
  return out;
}
