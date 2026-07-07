import { Check } from "lucide-react";
import { cn } from "~/lib/cn";

/** Multi-select chip list of active Abteilungen for the application form. */
export function AbteilungPicker({
  abteilungen,
  selected,
  onToggle,
  passive,
  onPassiveChange,
}: {
  abteilungen: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  passive?: boolean;
  onPassiveChange?: (active: boolean) => void;
}) {
  if (abteilungen.length === 0) {
    return <p className="text-sm text-muted-foreground">Keine Abteilungen verfügbar.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {onPassiveChange ? (
        <button
          type="button"
          onClick={() => onPassiveChange(!passive)}
          aria-pressed={Boolean(passive)}
          className={cn(
            "motion-chip-in inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-all active:scale-95",
            passive
              ? "border-primary bg-primary/10 text-foreground shadow-soft"
              : "border-border text-muted-foreground hover:border-ring/40",
          )}
        >
          {passive ? <Check className="motion-pop-in size-3.5 text-primary" /> : null}
          Keine Abteilung / passiv
        </button>
      ) : null}
      {abteilungen.map((a, i) => {
        const active = selected.includes(a.id);
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onToggle(a.id)}
            aria-pressed={active}
            style={{ animationDelay: `${i * 35}ms` }}
            className={cn(
              "motion-chip-in inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-all active:scale-95",
              active
                ? "border-primary bg-primary/10 text-foreground shadow-soft"
                : "border-border text-muted-foreground hover:border-ring/40",
            )}
          >
            {active ? <Check className="motion-pop-in size-3.5 text-primary" /> : null}
            {a.name}
          </button>
        );
      })}
    </div>
  );
}
