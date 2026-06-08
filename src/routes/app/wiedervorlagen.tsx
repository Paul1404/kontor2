import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ClipboardList, Loader2 } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { QueryError } from "~/components/ui/query-error";
import { toast } from "~/components/ui/toaster";
import { cn } from "~/lib/cn";
import { formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/wiedervorlagen")({
  component: WiedervorlagenPage,
});

type Task = {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  reference: string;
  name: string;
};

function WiedervorlagenPage() {
  const qc = useQueryClient();
  const worklist = useQuery({
    queryKey: ["tasks.worklist"],
    queryFn: () => orpc.tasks.worklist(),
  });

  const complete = useMutation({
    mutationFn: (id: string) => orpc.tasks.setStatus({ id, status: "done" }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tasks.worklist"] }),
        qc.invalidateQueries({ queryKey: ["tasks.counts"] }),
      ]);
    },
    onError: (e: Error) => toast.error("Aktion fehlgeschlagen", { description: e.message }),
  });

  const today = new Date().toISOString().slice(0, 10);
  const rows = worklist.data ?? [];
  const overdue = rows.filter((t) => t.dueDate != null && t.dueDate < today);
  const dueToday = rows.filter((t) => t.dueDate === today);
  const upcoming = rows.filter((t) => t.dueDate != null && t.dueDate > today);
  const undated = rows.filter((t) => t.dueDate == null);

  const groups: { key: string; label: string; tone: string; items: Task[] }[] = [
    { key: "overdue", label: "Überfällig", tone: "text-destructive", items: overdue },
    {
      key: "today",
      label: "Heute fällig",
      tone: "text-amber-600 dark:text-amber-400",
      items: dueToday,
    },
    { key: "upcoming", label: "Demnächst", tone: "text-foreground", items: upcoming },
    { key: "undated", label: "Ohne Datum", tone: "text-muted-foreground", items: undated },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ClipboardList className="size-6 text-brand" /> Wiedervorlagen
        </h1>
        <p className="text-sm text-muted-foreground">
          Offene Aufgaben über alle Mitglieder, fälligste zuerst. Erledigtes verschwindet aus der
          Liste.
        </p>
      </div>

      {worklist.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Lade…
        </div>
      ) : worklist.isError ? (
        <QueryError onRetry={() => worklist.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm">
            <Check className="size-7 text-emerald-500" />
            <div>
              <div className="font-semibold tracking-tight">Nichts offen.</div>
              <div className="text-muted-foreground">Keine offenen Wiedervorlagen.</div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div key={g.key} className="flex flex-col gap-2">
                <div className={cn("text-xs font-semibold uppercase tracking-wide", g.tone)}>
                  {g.label} ({g.items.length})
                </div>
                <Card>
                  <ul className="divide-y divide-border">
                    {g.items.map((t) => (
                      <li key={t.id} className="flex items-center gap-3 p-3">
                        <button
                          type="button"
                          onClick={() => complete.mutate(t.id)}
                          disabled={complete.isPending}
                          className="flex size-5 shrink-0 items-center justify-center rounded border border-muted-foreground/40 transition-colors hover:border-success hover:text-success"
                          aria-label="Als erledigt markieren"
                          title="Als erledigt markieren"
                        >
                          <Check className="size-3.5 opacity-0 hover:opacity-100" />
                        </button>
                        <div className="flex flex-1 flex-col">
                          <span className="text-sm font-medium">{t.title}</span>
                          {t.notes ? (
                            <span className="text-xs text-muted-foreground">{t.notes}</span>
                          ) : null}
                        </div>
                        <Link
                          to="/app/mitglieder/$mitgliedsnummer"
                          params={{ mitgliedsnummer: t.reference }}
                          className="shrink-0 text-sm text-brand hover:underline"
                        >
                          {t.name}
                        </Link>
                        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {t.dueDate ? formatDate(t.dueDate) : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
