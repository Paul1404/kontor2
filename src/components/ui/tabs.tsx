import type { LucideIcon } from "lucide-react";
import { useRef } from "react";
import { cn } from "~/lib/cn";

export type TabItem = {
  /** Stable id used as the active value. */
  value: string;
  label: string;
  icon?: LucideIcon;
  /** Optional count shown as a small chip after the label. */
  count?: number | null;
};

/**
 * Lightweight, accessible tab bar. Controlled: the parent owns the active
 * value and renders the matching panel itself. Roving arrow-key focus follows
 * the WAI-ARIA tabs pattern. Kept dependency-free to match the rest of the
 * hand-rolled UI primitives.
 */
export function Tabs({
  items,
  value,
  onValueChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % items.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else return;
    e.preventDefault();
    const item = items[next];
    if (!item) return;
    onValueChange(item.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={cn(
        "flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {items.map((item, index) => {
        const active = item.value === value;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:rounded-md",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-md",
            )}
          >
            {Icon ? <Icon className="size-4" /> : null}
            {item.label}
            {item.count != null && item.count > 0 ? (
              <span
                className={cn(
                  "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                  active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {item.count}
              </span>
            ) : null}
            {active ? (
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
