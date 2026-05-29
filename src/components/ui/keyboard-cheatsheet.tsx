import { Keyboard, X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

type Shortcut = { keys: string[]; label: string; needsRole?: Array<"vorstand" | "admin"> };

const SECTIONS: Array<{ title: string; items: Shortcut[] }> = [
  {
    title: "Allgemein",
    items: [
      { keys: ["⌘", "K"], label: "Befehlspalette / Suche" },
      { keys: ["/"], label: "Suche fokussieren" },
      { keys: ["?"], label: "Diese Übersicht öffnen / schließen" },
      { keys: ["Esc"], label: "Dialog / Overlay schließen" },
    ],
  },
  {
    title: "Navigation",
    items: [
      { keys: ["g", "d"], label: "Dashboard" },
      { keys: ["g", "m"], label: "Mitglieder" },
      { keys: ["g", "a"], label: "Audit Log" },
      { keys: ["g", "b"], label: "Beitragsläufe", needsRole: ["vorstand", "admin"] },
      { keys: ["g", "s"], label: "Snapshots", needsRole: ["admin"] },
    ],
  },
  {
    title: "Auf Listen- und Detailseiten",
    items: [
      { keys: ["n"], label: "Neues Mitglied anlegen (auf Mitgliederliste)" },
      { keys: ["e"], label: "Bearbeiten (auf Mitgliedsdetail)" },
    ],
  },
];

export function KeyboardCheatsheet({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: string;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a click-to-dismiss affordance; keyboard users dismiss via Escape (handled in the global shortcut hook) and via the close button.
    <div
      className="motion-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Tastaturkürzel"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="motion-zoom-in flex w-full max-w-lg flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-card">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="size-4 text-primary" />
            <h2 className="text-base font-semibold tracking-tight">Tastaturkürzel</h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Schließen"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-4 text-sm">
          {SECTIONS.map((section) => {
            const items = section.items.filter(
              (s) => !s.needsRole || s.needsRole.includes(role as never),
            );
            if (items.length === 0) return null;
            return (
              <div key={section.title} className="flex flex-col gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {section.title}
                </div>
                <ul className="flex flex-col divide-y divide-border/60 rounded-lg border border-border bg-muted/30">
                  {items.map((s) => (
                    <li key={s.label} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span>{s.label}</span>
                      <span className="flex items-center gap-1">
                        {s.keys.map((k) => (
                          <Kbd key={`${s.label}-${k}`}>{k}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Hinweis: Kürzel sind deaktiviert, solange Sie in einem Eingabefeld tippen.
        </p>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium text-foreground shadow-soft">
      {children}
    </kbd>
  );
}
