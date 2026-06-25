import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardList, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { DateField } from "~/components/ui/date-field";
import { Input } from "~/components/ui/input";
import { toast } from "~/components/ui/toaster";
import { cn } from "~/lib/cn";
import { formatDate } from "~/lib/format";
import { orpc } from "~/lib/orpc";

/**
 * Wiedervorlagen (follow-up tasks) for one member. Add a task with an optional
 * due date, tick it off, reopen, or delete. Overdue open tasks are flagged.
 */
export function WiedervorlagenCard({ memberId, canEdit }: { memberId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  const tasks = useQuery({
    queryKey: ["tasks.forMember", memberId],
    queryFn: () => orpc.tasks.listForMember({ memberId }),
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["tasks.forMember", memberId] }),
      qc.invalidateQueries({ queryKey: ["tasks.counts"] }),
      qc.invalidateQueries({ queryKey: ["tasks.worklist"] }),
    ]);
  };

  const create = useMutation({
    mutationFn: () =>
      orpc.tasks.create({ memberId, title: title.trim(), dueDate: dueDate || null }),
    onSuccess: async () => {
      setTitle("");
      setDueDate("");
      await invalidate();
    },
    onError: (e: Error) => toast.error("Konnte nicht angelegt werden", { description: e.message }),
  });

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: "open" | "done" }) => orpc.tasks.setStatus(v),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error("Aktion fehlgeschlagen", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => orpc.tasks.remove({ id }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error("Löschen fehlgeschlagen", { description: e.message }),
  });

  const rows = tasks.data ?? [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="size-5 text-brand" /> Wiedervorlagen
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {canEdit ? (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) create.mutate();
            }}
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="z. B. IBAN nachfordern"
              className="flex-1"
            />
            <DateField
              value={dueDate}
              onChange={(v) => setDueDate(v)}
              className="sm:w-40"
              aria-label="Fällig am"
            />
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Anlegen
            </Button>
          </form>
        ) : null}

        {tasks.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Lade…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Wiedervorlagen.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((t) => {
              const done = t.status === "done";
              const overdue = !done && t.dueDate != null && t.dueDate < today;
              return (
                <li key={t.id} className="flex items-center gap-3 py-2">
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => setStatus.mutate({ id: t.id, status: done ? "open" : "done" })}
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded border transition-colors",
                        done
                          ? "border-success bg-success/15 text-success"
                          : "border-muted-foreground/40 hover:border-brand",
                      )}
                      aria-label={done ? "Wieder öffnen" : "Erledigt"}
                      title={done ? "Wieder öffnen" : "Als erledigt markieren"}
                    >
                      {done ? <Check className="size-3.5" /> : null}
                    </button>
                  ) : null}
                  <div className="flex flex-1 flex-col">
                    <span className={cn("text-sm", done && "text-muted-foreground line-through")}>
                      {t.title}
                    </span>
                    {t.dueDate ? (
                      <span
                        className={cn(
                          "text-xs",
                          overdue ? "font-medium text-destructive" : "text-muted-foreground",
                        )}
                      >
                        fällig {formatDate(t.dueDate)}
                        {overdue ? " · überfällig" : ""}
                      </span>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 items-center gap-1">
                      {done ? (
                        <button
                          type="button"
                          onClick={() => setStatus.mutate({ id: t.id, status: "open" })}
                          className="rounded p-1 text-muted-foreground hover:text-foreground"
                          aria-label="Wiedervorlage wieder öffnen"
                          title="Wieder öffnen"
                        >
                          <RotateCcw className="size-4" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => remove.mutate(t.id)}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                        aria-label="Wiedervorlage löschen"
                        title="Löschen"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
