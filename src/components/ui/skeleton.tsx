import { cn } from "~/lib/cn";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted/70", className)}
      {...props}
    />
  );
}

export function SkeletonText({
  lines = 1,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: pure visual placeholder, never reordered
          key={i}
          className={cn("h-3", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

export function SkeletonTableRows({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr
          // biome-ignore lint/suspicious/noArrayIndexKey: pure visual placeholder
          key={r}
          className="border-b border-border/60 last:border-b-0"
        >
          {Array.from({ length: cols }).map((_, c) => (
            <td
              // biome-ignore lint/suspicious/noArrayIndexKey: pure visual placeholder
              key={c}
              className="px-4 py-3"
            >
              <Skeleton className={cn("h-3", c === 0 ? "w-16" : c === 1 ? "w-40" : "w-24")} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
