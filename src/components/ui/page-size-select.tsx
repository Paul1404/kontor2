import { useEffect, useState } from "react";

const DEFAULT_OPTIONS = [25, 50, 100, 200] as const;

type Props = {
  value: number;
  onChange: (next: number) => void;
  options?: readonly number[];
};

export function PageSizeSelect({ value, onChange, options = DEFAULT_OPTIONS }: Props) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>Pro Seite</span>
      <select
        value={value}
        onChange={(e) => {
          const next = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="h-8 rounded-md border border-input bg-card px-2 text-sm shadow-soft focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Persist a numeric pageSize across reloads. SSR-safe: starts with the
 * initial value, then hydrates from localStorage on mount.
 */
export function usePersistentPageSize(
  key: string,
  initial: number,
): [number, (next: number) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(key);
    if (!stored) return;
    const parsed = Number.parseInt(stored, 10);
    if (Number.isFinite(parsed) && parsed > 0) setValue(parsed);
  }, [key]);
  const set = (next: number) => {
    setValue(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, String(next));
    }
  };
  return [value, set];
}
