import { HelpCircle } from "lucide-react";
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/cn";

/**
 * Shared form primitives for the public Beitritts-Antrag.
 *
 * `Field` keeps the layout stable while the applicant types: the helper line
 * under the control is always reserved (hint or error swap in place) and
 * validity is shown on the control's border via `data-field-state`, not with an
 * extra icon that would move the label. `Reveal` animates height for anything
 * that appears or disappears mid-form so the page never jumps.
 */

export type FieldState = "idle" | "valid" | "invalid";

/** Derive the visual state: an error wins, a non-empty valid value turns green. */
export function fieldStateOf(value: string, valid: boolean, error?: string | null): FieldState {
  if (error) return "invalid";
  if (value.trim() && valid) return "valid";
  return "idle";
}

export function Field({
  label,
  hint,
  state = "idle",
  error,
  anchorId,
  pulseNonce,
  help,
  className,
  children,
}: {
  label: string;
  hint?: string;
  state?: FieldState;
  error?: string | null;
  /** DOM id used as the scroll-to-error anchor (e.g. "f-vorname"). */
  anchorId?: string;
  /** Changes on every failed step validation to replay the attention pulse. */
  pulseNonce?: number;
  help?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const invalid = Boolean(error);
  // Flag the underlying control as invalid for assistive tech.
  const control =
    invalid && isValidElement(children)
      ? cloneElement(children as ReactElement<{ "aria-invalid"?: boolean }>, {
          "aria-invalid": true,
        })
      : children;
  const resolvedState: FieldState = invalid ? "invalid" : state;
  return (
    <div id={anchorId} className={cn("scroll-mt-24", className)}>
      <Label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5">
          {label}
          {help ? <HelpTip text={help} /> : null}
        </span>
        <span data-field-state={resolvedState} className="relative block rounded-lg">
          {control}
          {invalid ? (
            // Keyed overlay so the pulse replays per failed step check without
            // remounting the control (which would drop focus mid-typing).
            <span
              key={pulseNonce}
              aria-hidden
              className="field-pulse pointer-events-none absolute inset-0 rounded-lg"
            />
          ) : null}
        </span>
        <FieldHelper error={error} hint={hint} />
      </Label>
    </div>
  );
}

/** Reserved one-line helper row: an error replaces the hint in place. */
export function FieldHelper({ error, hint }: { error?: string | null; hint?: string }) {
  return (
    <span
      aria-live="polite"
      className={cn(
        "block min-h-4 text-xs font-normal leading-4 transition-colors",
        error ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {error ?? hint ?? ""}
    </span>
  );
}

/** Small inline help: a question-mark button that toggles a short tooltip. */
export function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="Hilfe anzeigen"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className="text-muted-foreground hover:text-foreground"
      >
        <HelpCircle className="size-3.5" />
      </button>
      {open ? (
        <span className="motion-pop-in absolute left-5 top-0 z-10 w-56 rounded-lg border border-border bg-popover p-2.5 text-xs font-normal leading-relaxed text-popover-foreground shadow-elevated">
          {text}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Height transition for content that comes and goes. Children stay mounted
 * while collapsing so the close animates; a collapsed block is `inert` so it
 * neither takes focus nor is read out. Overflow is clipped only while the
 * height animates, so popovers inside (date pickers) are not cut off once open.
 */
export function Reveal({
  open,
  children,
  className,
  collapsedClassName,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
  /**
   * Applied while collapsed. Inside a flex/grid container with `gap`, pass the
   * matching negative margin (e.g. "-mt-6") so the empty block does not keep
   * its gap; the margin animates together with the height.
   */
  collapsedClassName?: string;
}) {
  const [settled, setSettled] = useState(open);
  const last = useRef<React.ReactNode>(children);
  if (open) last.current = children;
  useEffect(() => {
    if (!open) {
      setSettled(false);
      return;
    }
    // Matches the CSS duration; also covers reduced motion where no
    // transitionend would fire.
    const t = setTimeout(() => setSettled(true), 300);
    return () => clearTimeout(t);
  }, [open]);
  return (
    <div
      className={cn(
        "reveal",
        open ? "reveal-open" : collapsedClassName,
        open && settled && "reveal-settled",
        className,
      )}
      inert={!open}
    >
      <div className="reveal-inner">{open ? children : last.current}</div>
    </div>
  );
}
