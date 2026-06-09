import { type ReactNode, useId, useState } from "react";
import { cn } from "~/lib/cn";

type Side = "top" | "bottom";

/**
 * A small, dependency-free tooltip. Shows on hover and on keyboard focus, and
 * exposes its text to assistive tech via `aria-describedby`. Use it instead of
 * the native `title` attribute, whose browser-default bubble is slow to appear,
 * unstyled, and invisible to touch and keyboard users.
 *
 * The trigger is wrapped in an inline element, so it works for chips, badges
 * and icon buttons sitting in a line of text.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: Side;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  if (content == null || content === "") return <>{children}</>;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover/focus only reveal a descriptive tooltip; the text is also linked to the trigger via aria-describedby and role="tooltip"
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>
      <span
        role="tooltip"
        id={id}
        hidden={!open}
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-xs -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-center text-xs font-normal leading-snug text-popover-foreground shadow-md",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
