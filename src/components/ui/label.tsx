import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "~/lib/cn";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    // Design-system primitive: consumers always pass `htmlFor` (or wrap a
    // control). The association is enforced at the call site, not here.
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor supplied by consumers
    <label
      ref={ref}
      className={cn("text-sm font-medium leading-none text-foreground", className)}
      {...props}
    />
  ),
);
Label.displayName = "Label";
