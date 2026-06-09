import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, ChevronDown, Layers, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { QueryError } from "~/components/ui/query-error";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/einstellungen/abteilungen")({
  component: AbteilungenSettingsPage,
});

type AbtRow = {
  id: string;
  name: string;
  slug: string;
  sportart: string | null;
  verbandName: string | null;
  verbandNr: string | null;
  inaktiv: boolean;
  memberCount: number;
  totalCount: number;
};

function AbteilungenSettingsPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["abteilungen", "list"],
    queryFn: () => orpc.abteilungen.list(),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["abteilungen"] });

  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  const create = useMutation({
    mutationFn: () => orpc.abteilungen.create({ name: newName.trim() }),
    onSuccess: async () => {
      setNewName("");
      setCreateError(null);
      await refresh();
    },
    onError: (e: unknown) => setCreateError(e instanceof Error ? e.message : "Fehler"),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      orpc.abteilungen.rename({ id, name: name.trim() }),
    onSuccess: async () => {
      setEditingId(null);
      setActionError(null);
      await refresh();
    },
    onError: (e: unknown) => setActionError(e instanceof Error ? e.message : "Fehler"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => orpc.abteilungen.delete({ id }),
    onSuccess: async () => {
      setActionError(null);
      await refresh();
    },
    onError: (e: unknown) => setActionError(e instanceof Error ? e.message : "Fehler"),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Layers className="size-6 text-brand" /> Abteilungen
        </h1>
        <p className="text-sm text-muted-foreground">
          Sportabteilungen oder Sparten des Vereins. Mitglieder werden auf der Mitgliederseite
          zugeordnet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Neue Abteilung</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) create.mutate();
            }}
          >
            <div className="flex min-w-60 flex-1 flex-col gap-1.5">
              <Label htmlFor="abt-name">Name</Label>
              <Input
                id="abt-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="z. B. Fußball"
                maxLength={80}
              />
            </div>
            <Button type="submit" disabled={!newName.trim() || create.isPending}>
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Anlegen
            </Button>
          </form>
          {createError ? <p className="mt-2 text-sm text-destructive">{createError}</p> : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border bg-muted/40 px-4 py-3 text-sm font-semibold">
          Alle Abteilungen
        </div>
        {actionError ? (
          <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {actionError}
          </div>
        ) : null}
        <ul className="divide-y divide-border">
          {list.isLoading ? (
            <li className="px-4 py-8 text-center text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Wird geladen…
              </span>
            </li>
          ) : list.isError ? (
            <li className="px-4 py-6">
              <QueryError onRetry={() => list.refetch()} />
            </li>
          ) : !list.data || list.data.length === 0 ? (
            <li className="px-4 py-8 text-center text-muted-foreground">Noch keine Abteilungen.</li>
          ) : (
            (list.data as AbtRow[]).map((a) => {
              const isEditing = editingId === a.id;
              const isExpanded = expandedId === a.id;
              const canDelete = a.totalCount === 0;
              return (
                <li key={a.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setExpandedId((cur) => (cur === a.id ? null : a.id))}
                      className="flex flex-1 items-center gap-2 text-left hover:text-foreground"
                    >
                      <ChevronDown
                        className={`size-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                      {isEditing ? (
                        <Input
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          maxLength={80}
                          className="max-w-xs"
                        />
                      ) : (
                        <span className="font-medium">{a.name}</span>
                      )}
                      {a.sportart ? (
                        <span className="text-xs text-muted-foreground">· {a.sportart}</span>
                      ) : null}
                      {a.inaktiv ? (
                        <Badge variant="secondary" className="text-xs">
                          Inaktiv
                        </Badge>
                      ) : (
                        <Badge variant="success" className="text-xs">
                          Aktiv
                        </Badge>
                      )}
                    </button>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {a.memberCount} aktiv · {a.totalCount} gesamt
                    </span>
                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => rename.mutate({ id: a.id, name: editDraft })}
                            disabled={!editDraft.trim() || rename.isPending}
                            aria-label="Umbenennen speichern"
                            title="Speichern"
                          >
                            {rename.isPending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Check className="size-4" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                            aria-label="Bearbeitung abbrechen"
                            title="Abbrechen"
                          >
                            <X className="size-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingId(a.id);
                              setEditDraft(a.name);
                              setActionError(null);
                            }}
                            aria-label={`Abteilung "${a.name}" umbenennen`}
                            title="Umbenennen"
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmDelete({ id: a.id, name: a.name })}
                            disabled={!canDelete || remove.isPending}
                            aria-label={`Abteilung "${a.name}" löschen`}
                            title={canDelete ? "Löschen" : "Erst alle Mitgliedschaften entfernen"}
                          >
                            <Trash2
                              className={`size-4 ${canDelete ? "text-destructive" : "text-muted-foreground"}`}
                            />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {isExpanded ? (
                    <AbteilungDetailsForm
                      row={a}
                      onSaved={async () => {
                        await refresh();
                      }}
                    />
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      </Card>

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
        title="Abteilung löschen?"
        description={confirmDelete ? `"${confirmDelete.name}" wird dauerhaft entfernt.` : undefined}
        confirmLabel="Löschen"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (!confirmDelete) return;
          remove.mutate(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}

function AbteilungDetailsForm({
  row,
  onSaved,
}: {
  row: AbtRow;
  onSaved: () => Promise<void> | void;
}) {
  const [sportart, setSportart] = useState(row.sportart ?? "");
  const [verbandName, setVerbandName] = useState(row.verbandName ?? "");
  const [verbandNr, setVerbandNr] = useState(row.verbandNr ?? "");
  const [inaktiv, setInaktiv] = useState(row.inaktiv);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      orpc.abteilungen.update({
        id: row.id,
        sportart: sportart.trim() || null,
        verbandName: verbandName.trim() || null,
        verbandNr: verbandNr.trim() || null,
        inaktiv,
      }),
    onSuccess: () => {
      setError(null);
      return onSaved();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen."),
  });

  return (
    <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/30 p-3 md:grid-cols-2">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: each label wraps its Input below and is implicitly associated. */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Sportart</span>
        <Input
          value={sportart}
          onChange={(e) => setSportart(e.target.value)}
          placeholder="z. B. Fußball"
        />
      </label>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: each label wraps its Input below and is implicitly associated. */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Verband</span>
        <Input
          value={verbandName}
          onChange={(e) => setVerbandName(e.target.value)}
          placeholder="z. B. Bayerischer Fußball-Verband e.V."
        />
      </label>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: each label wraps its Input below and is implicitly associated. */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Verband-Nr.</span>
        <Input value={verbandNr} onChange={(e) => setVerbandNr(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 self-end text-sm">
        <input
          type="checkbox"
          checked={inaktiv}
          onChange={(e) => setInaktiv(e.target.checked)}
          className="size-4 accent-primary"
        />
        <span>Inaktiv (nicht mehr aktive Abteilung)</span>
      </label>
      <div className="flex items-center justify-end gap-2 md:col-span-2">
        {error ? <span className="mr-auto text-sm text-destructive">{error}</span> : null}
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Speichern
        </Button>
      </div>
    </div>
  );
}
