import { CalendarDays } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Matcher } from "react-day-picker";
import { Calendar } from "~/components/ui/calendar";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/cn";
import { formatDateInput, parseDateInput } from "~/lib/format";

type DateFieldProps = {
  /** Stored value as ISO YYYY-MM-DD, or "" when empty. */
  value: string;
  /** Called with the new ISO YYYY-MM-DD value, or "" when cleared. */
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  /** Earliest selectable date as ISO YYYY-MM-DD. */
  min?: string;
  /** Latest selectable date as ISO YYYY-MM-DD. */
  max?: string;
  placeholder?: string;
  "aria-label"?: string;
};

/** ISO YYYY-MM-DD -> a local Date at midnight (calendar date preserved). */
function isoToDate(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

/** A picked local Date -> ISO YYYY-MM-DD using local getters (no TZ shift). */
function dateToIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A date field you can type or paste into (German DD.MM.YYYY, also tolerant of
 * ISO and two-digit years) with a calendar popover for picking. Replaces the
 * native `<input type="date">` so the experience is the same in every browser.
 * The value is held and emitted as ISO YYYY-MM-DD, matching how dates are
 * stored, so it is a drop-in for the old input.
 */
export function DateField({
  value,
  onChange,
  id,
  className,
  disabled,
  required,
  min,
  max,
  placeholder = "TT.MM.JJJJ",
  "aria-label": ariaLabel,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => formatDateInput(value));
  const wrapRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const inputId = id ?? reactId;

  // Resync the visible text when the controlled value changes from outside (form
  // load, reset, calendar pick). Skip while the user is mid-typing a string that
  // already parses to the current value, so we don't reformat under the cursor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: draft is read but intentionally not a trigger.
  useEffect(() => {
    if (parseDateInput(draft) !== value) setDraft(formatDateInput(value));
  }, [value]);

  // Close the popover on outside pointer or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleText = (text: string) => {
    setDraft(text);
    const parsed = parseDateInput(text);
    // Empty -> clear. A valid date -> commit. null means "still typing or not a
    // real date"; leave the stored value untouched until blur.
    if (parsed === "") onChange("");
    else if (parsed !== null) onChange(parsed);
  };

  const handleBlur = () => {
    const parsed = parseDateInput(draft);
    if (parsed === null) {
      // Unparseable: revert the text to the last good value.
      setDraft(formatDateInput(value));
    } else {
      setDraft(formatDateInput(parsed));
    }
  };

  const selected = isoToDate(value);
  const matchers: Matcher[] = [];
  const before = isoToDate(min);
  const after = isoToDate(max);
  if (before) matchers.push({ before });
  if (after) matchers.push({ after });

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={ariaLabel}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => handleText(e.target.value)}
        onBlur={handleBlur}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label="Kalender öffnen"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"
      >
        <CalendarDays className="h-4 w-4" />
      </button>
      {open ? (
        <div
          role="dialog"
          className="absolute left-0 top-full z-50 mt-1 rounded-lg border border-input bg-card shadow-card"
        >
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            disabled={matchers.length > 0 ? matchers : undefined}
            onSelect={(d) => {
              if (d) {
                const iso = dateToIso(d);
                onChange(iso);
                setDraft(formatDateInput(iso));
              }
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
