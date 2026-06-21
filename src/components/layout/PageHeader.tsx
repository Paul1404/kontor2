import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

/**
 * Canonical top-of-page header so every route shares one visual hierarchy:
 * an optional eyebrow, the H1 (optionally icon-led), a muted description, and a
 * right-aligned action slot. Replaces the hand-rolled `<h1 class="text-2xl …">`
 * blocks scattered across routes so titles, sizes and spacing stay consistent.
 */
export function PageHeader({
  title,
  description,
  icon,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Optional leading icon (lucide), rendered muted before the title. */
  icon?: ReactNode;
  /** Right-aligned actions (buttons, filters). Wraps below the title on narrow screens. */
  actions?: ReactNode;
  /** Small uppercase label above the title, e.g. a section or breadcrumb. */
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? (
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {eyebrow}
          </span>
        ) : null}
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
          <span className="truncate">{title}</span>
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
