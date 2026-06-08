import { useQuery } from "@tanstack/react-query";
import {
  Award,
  FileWarning,
  History,
  Loader2,
  Mails,
  Pencil,
  ScrollText,
  Undo2,
} from "lucide-react";
import type { ComponentType } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { QueryError } from "~/components/ui/query-error";
import { cn } from "~/lib/cn";
import { formatDateTime } from "~/lib/format";
import { orpc } from "~/lib/orpc";

type Kind = "audit" | "dunning" | "kulanz" | "rundschreiben" | "sepa_return" | "ehrung";

const ICONS: Record<Kind, ComponentType<{ className?: string }>> = {
  audit: Pencil,
  dunning: FileWarning,
  kulanz: ScrollText,
  rundschreiben: Mails,
  sepa_return: Undo2,
  ehrung: Award,
};

const TONES: Record<Kind, string> = {
  audit: "bg-muted text-muted-foreground",
  dunning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  kulanz: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  rundschreiben: "bg-brand/15 text-brand",
  sepa_return: "bg-red-500/15 text-red-600 dark:text-red-400",
  ehrung: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
};

/** Merged chronological activity feed for one member. */
export function AktivitaetTimeline({ memberId }: { memberId: string }) {
  const q = useQuery({
    queryKey: ["timeline.forMember", memberId],
    queryFn: () => orpc.timeline.forMember({ memberId }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-5 text-brand" /> Aktivität
        </CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Lade Verlauf…
          </div>
        ) : q.isError ? (
          <QueryError onRetry={() => q.refetch()} />
        ) : !q.data || q.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Aktivität erfasst.</p>
        ) : (
          <ol className="flex flex-col">
            {q.data.map((e, i) => {
              const Icon = ICONS[e.kind as Kind] ?? History;
              const last = i === q.data.length - 1;
              return (
                <li key={e.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full",
                        TONES[e.kind as Kind],
                      )}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    {!last ? <span className="w-px flex-1 bg-border" /> : null}
                  </div>
                  <div className={cn("flex flex-1 flex-col pb-4", last && "pb-0")}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{e.title}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatDateTime(e.at)}
                      </span>
                    </div>
                    {e.detail ? (
                      <span className="text-xs text-muted-foreground">{e.detail}</span>
                    ) : null}
                    {e.actor ? (
                      <span className="text-xs text-muted-foreground/70">{e.actor}</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
