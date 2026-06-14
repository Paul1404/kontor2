import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ClipboardList, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { QueryError } from "~/components/ui/query-error";
import { toast } from "~/components/ui/toaster";
import { cn } from "~/lib/cn";
import { formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/wiedervorlagen")({
  component: WiedervorlagenPage,
});

type View = "open" | "done" | "all";

type Task = {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  status: "open" | "done";
  completedAt: string | Date | null;
  reference: string;
  name: string;
};

const VIEW_TABS: { key: View; label: string }[] = [
  { key: "open", label: "Offen" },
  { key: "done", label: "Erledigt" },
  { key: "all", label: "Alle" },
];

function WiedervorlagenPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>("open");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; label: string } | null>(null);

  const worklist = useQuery({
    queryKey: ["tasks.worklist", view],
    queryFn: () => orpc.tasks.worklist({ view }),
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["tasks.worklist"] }),
      qc.invalidateQueries({ queryKey: ["tasks.counts"] }),
    ]);
  };

  const rows = (worklist.data ?? []) as Task[];
  const ids = rows.map((t) => t.id);
  const selectedIds = ids.filter((id) => selected.has(id));
  const selectedCount = selectedIds.length;
  const allSelected = ids.length > 0 && selectedCount === ids.length;

  const clearSelection = () => setSelected(new Set());

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(ids));

  const setStatus = useMutation({
    mutationFn: (vars: { id: string; status: "open" | "done" }) => orpc.tasks.setStatus(vars),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error("Aktion fehlgeschlagen", { description: e.message }),
  });

  const bulkStatus = useMutation({
    mutationFn: (vars: { ids: string[]; status: "open" | "done" }) =>
      orpc.tasks.setStatusMany(vars),
    onSuccess: async (res, vars) => {
      toast.success(
        vars.status === "done"
          ? `${res.count} als erledigt markiert`
          : `${res.count} wieder geöffnet`,
      );
      clearSelection();
      await invalidate();
    },
    onError: (e: Error) => toast.error("Aktion fehlgeschlagen", { description: e.message }),
  });

  const bulkDelete = useMutation({
    mutationFn: (deleteIds: string[]) => orpc.tasks.removeMany({ ids: deleteIds }),
    onSuccess: async (res) => {
      toast.success(`${res.count} gelöscht`);
      setConfirmDelete(null);
      clearSelection();
      await invalidate();
    },
    onError: (e: Error) => {
      setConfirmDelete(null);
      toast.error("Löschen fehlgeschlagen", { description: e.message });
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const busy = setStatus.isPending || bulkStatus.isPending || bulkDelete.isPending;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ClipboardList className="size-6 text-brand" /> Wiedervorlagen
        </h1>
        <p className="text-sm text-muted-foreground">
          Aufgaben über alle Mitglieder, fälligste zuerst. Mehrere auswählen, um sie gemeinsam zu
          erledigen oder zu löschen.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 self-start rounded-lg border border-border p-0.5">
          {VIEW_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setView(t.key);
                clearSelection();
              }}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                view === t.key
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
          <span className="px-1 text-sm font-medium">{selectedCount} ausgewählt</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => bulkStatus.mutate({ ids: selectedIds, status: "done" })}
            >
              <Check className="size-4" /> Als erledigt
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => bulkStatus.mutate({ ids: selectedIds, status: "open" })}
            >
              <RotateCcw className="size-4" /> Wieder öffnen
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={busy}
              onClick={() =>
                setConfirmDelete({ ids: selectedIds, label: `${selectedCount} Wiedervorlagen` })
              }
            >
              <Trash2 className="size-4" /> Löschen
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
              Auswahl aufheben
            </Button>
          </div>
        </div>
      ) : null}

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
              <div className="font-semibold tracking-tight">
                {view === "done" ? "Nichts erledigt." : "Nichts offen."}
              </div>
              <div className="text-muted-foreground">
                {view === "done"
                  ? "Keine erledigten Wiedervorlagen."
                  : "Keine offenen Wiedervorlagen."}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              aria-label="Alle auswählen"
              className="size-4 rounded border-muted-foreground/40"
            />
            <span>Alle auswählen</span>
            <span className="ml-auto tabular-nums">{rows.length}</span>
          </div>
          <ul className="divide-y divide-border">
            {rows.map((t) => {
              const isDone = t.status === "done";
              const overdue = !isDone && t.dueDate != null && t.dueDate < today;
              const isSelected = selected.has(t.id);
              return (
                <li
                  key={t.id}
                  className={cn("flex items-center gap-3 p-3", isSelected && "bg-primary/5")}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(t.id)}
                    aria-label={`${t.title} auswählen`}
                    className="size-4 rounded border-muted-foreground/40"
                  />
                  <div className="flex flex-1 flex-col">
                    <span
                      className={cn(
                        "text-sm font-medium",
                        isDone && "text-muted-foreground line-through",
                      )}
                    >
                      {t.title}
                    </span>
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
                  <span
                    className={cn(
                      "w-24 shrink-0 text-right text-xs tabular-nums",
                      overdue ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {t.dueDate ? formatDate(t.dueDate) : ""}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {isDone ? (
                      <button
                        type="button"
                        onClick={() => setStatus.mutate({ id: t.id, status: "open" })}
                        disabled={busy}
                        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label="Wieder öffnen"
                        title="Wieder öffnen"
                      >
                        <RotateCcw className="size-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setStatus.mutate({ id: t.id, status: "done" })}
                        disabled={busy}
                        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-success/10 hover:text-success"
                        aria-label="Als erledigt markieren"
                        title="Als erledigt markieren"
                      >
                        <Check className="size-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setConfirmDelete({ ids: [t.id], label: t.title })}
                      disabled={busy}
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Löschen"
                      title="Löschen"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
        title="Wiedervorlage löschen?"
        description={
          confirmDelete
            ? `${confirmDelete.label} wird dauerhaft gelöscht. Dies kann nicht rückgängig gemacht werden.`
            : ""
        }
        confirmLabel="Löschen"
        destructive
        loading={bulkDelete.isPending}
        onConfirm={() => {
          if (confirmDelete) bulkDelete.mutate(confirmDelete.ids);
        }}
      />
    </div>
  );
}
