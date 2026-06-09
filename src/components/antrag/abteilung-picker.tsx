import { Check } from "lucide-react";
import { cn } from "~/lib/cn";

/** Multi-select chip list of active Abteilungen for the application form. */
export function AbteilungPicker({
  abteilungen,
  selected,
  onToggle,
}: {
  abteilungen: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (abteilungen.length === 0) {
    return <p className="text-sm text-muted-foreground">Keine Abteilungen verfügbar.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {abteilungen.map((a) => {
        const active = selected.includes(a.id);
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onToggle(a.id)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-ring/40",
            )}
          >
            {active ? <Check className="size-3.5 text-primary" /> : null}
            {a.name}
          </button>
        );
      })}
    </div>
  );
}
