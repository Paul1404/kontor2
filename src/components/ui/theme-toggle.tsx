import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "~/lib/cn";
import { type Theme, useTheme } from "~/lib/theme";

const OPTIONS: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Hell", icon: Sun },
  { value: "dark", label: "Dunkel", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5 shadow-soft",
        className,
      )}
      role="radiogroup"
      aria-label="Farbschema"
    >
      {OPTIONS.map((o) => {
        const active = theme === o.value;
        const Icon = o.icon;
        return (
          // Styled segmented control: an icon-only button carrying the radio
          // role, not a native <input type="radio">, so it can be themed.
          // biome-ignore lint/a11y/useSemanticElements: themed radio button
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            onClick={() => setTheme(o.value)}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" strokeWidth={2.25} />
          </button>
        );
      })}
    </div>
  );
}
