import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import { DayPicker } from "react-day-picker";
import { de } from "react-day-picker/locale";
import { cn } from "~/lib/cn";

export type CalendarProps = ComponentProps<typeof DayPicker>;

/**
 * A calendar styled to match the app, built on react-day-picker. German locale
 * (Monday-first weeks, German month and weekday names) and a month/year
 * dropdown so jumping to a birth year is one click, not forty taps on a chevron.
 * Used inside DateField; can also stand alone.
 */
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "dropdown",
  startMonth,
  endMonth,
  ...props
}: CalendarProps) {
  const navButton =
    "inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-card text-foreground shadow-soft transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40";

  // The dropdown caption otherwise caps navigation at "100 years ago to end of
  // this year", which hides future dates (renewals, deadlines). Span a century
  // back to a decade ahead so every realistic date is reachable.
  const thisYear = new Date().getFullYear();

  return (
    <DayPicker
      locale={de}
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      startMonth={startMonth ?? new Date(thisYear - 100, 0)}
      endMonth={endMonth ?? new Date(thisYear + 10, 11)}
      className={cn("p-3", className)}
      classNames={{
        months: "relative flex flex-col",
        month: "space-y-3",
        nav: "absolute inset-x-0 top-3 flex items-center justify-between px-3",
        button_previous: navButton,
        button_next: navButton,
        month_caption: "flex h-7 items-center justify-center px-9",
        dropdowns: "flex items-center gap-1.5 text-sm font-medium",
        dropdown_root:
          "relative inline-flex h-7 items-center gap-1 rounded-md border border-input bg-card px-2 text-foreground shadow-soft transition-colors hover:bg-accent",
        dropdown: "absolute inset-0 cursor-pointer opacity-0",
        caption_label: "flex items-center gap-1",
        chevron: "text-muted-foreground",
        month_grid: "mt-2 w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-9 pb-1 text-center text-[0.7rem] font-normal uppercase tracking-wide text-muted-foreground",
        week: "flex w-full",
        day: "p-0 text-center text-sm",
        day_button:
          "mx-auto flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-selected:bg-primary aria-selected:text-primary-foreground aria-selected:hover:bg-primary",
        today:
          "[&>button]:font-semibold [&>button]:text-primary [&>button]:aria-selected:text-primary-foreground",
        outside: "[&>button]:text-muted-foreground/40",
        disabled: "[&>button]:pointer-events-none [&>button]:opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: cls, size }) => {
          const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
          return <Icon className={cn("h-4 w-4", cls)} size={size} />;
        },
      }}
      {...props}
    />
  );
}
