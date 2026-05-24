import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "~/lib/cn";

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  description?: string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, description, checked, id, ...props }, ref) => (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 text-sm transition-colors hover:border-ring/40",
        className,
      )}
    >
      <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center">
        <input
          ref={ref}
          type="checkbox"
          id={id}
          checked={checked}
          className="peer sr-only"
          {...props}
        />
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring/40"
        />
        <span
          aria-hidden
          className="absolute left-0.5 top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow-soft transition-transform peer-checked:translate-x-4"
        />
      </span>
      <span className="flex flex-col leading-tight">
        {label ? <span className="font-medium text-foreground">{label}</span> : null}
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  ),
);
Switch.displayName = "Switch";
